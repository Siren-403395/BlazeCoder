/**
 * The agent loop — the harness core. Deliberately dumb: gather context → call
 * model → execute tool calls → feed results back → repeat, until the model emits
 * no tool calls (model-decided done) or one of OUR caps trips. Permissions,
 * compaction, and persistence are sibling modules it calls into.
 */

import type { ResultSubtype, StopReason, TokenUsage } from "@blazecoder/shared";
import type {
  Clock,
  EventSink,
  Logger,
  MemoryStore,
  ModelGateway,
  ModelResponse,
  Sandbox,
  SessionState,
  SteeringQueue,
  Workspace,
} from "../ports";
import { assembleRequest, computeBudget, estimateRequestTokens } from "../context/sessionContext";
import { CompactionThrashError, ContextManager, ContextOverflowError } from "../context/compaction";
import { outputBudget, type Effort } from "../effort";
import { buildLoopConfig } from "./config";
import { DenialTracker } from "../permissions/denialTracking";
import { initialLoopState, terminalToSubtype } from "./transitions";
import type { LoopState, Terminal } from "./transitions";
import type { ReadLedger } from "../workspace/ledger";
import type { HookBus } from "../permissions/hooks";
import type { ToolContext } from "../tools/registry";
import type { ToolRegistry } from "../tools/registry";
import { ToolExecutor } from "../tools/executor";

export interface AgentRunResult {
  subtype: ResultSubtype;
  numTurns: number;
  sessionId: string;
  stopReason: StopReason;
  totalCostUsd: number;
  usage: TokenUsage;
  summary: string;
}

export interface AgentLoopConfig {
  /** Full prompt override (a custom --system-prompt); when absent the sectioned builder runs. */
  promptOverride?: string;
  /** Extra durable instructions appended as a final system-prompt section. */
  extraInstructions?: string;
  /** Optional mode/persona prompt slotted near the end of the system prompt. */
  modePrompt?: string;
  /** Which prompt contract to build: "main" (default) or the leaner "subagent". */
  promptVariant?: "main" | "subagent";
  userRules?: string;
  /** Passively-recalled memory index for THIS run (set per-run in AgentRuntime.run; sub-agents omit it). */
  memorySection?: string;
  /** Hard ceiling on tool-use turns. Omit (undefined) for NO cap — the loop runs until the
   *  model is done, the user interrupts, or a context/compaction terminal trips. */
  maxTurns?: number;
  /** Hard ceiling on accumulated $ cost. Omit (undefined) for NO cap (same rationale as maxTurns). */
  maxBudgetUsd?: number;
  contextTokens: number;
  temperature?: number;
  maxOutputTokens?: number;
  /** Reasoning effort for this run (maps to thinking mode + output budget). */
  effort?: Effort;
}

export interface AgentLoopDeps {
  gateway: ModelGateway;
  registry: ToolRegistry;
  executor: ToolExecutor;
  contextManager: ContextManager;
  ledger: ReadLedger;
  sandbox: Sandbox;
  memory: MemoryStore;
  clock: Clock;
  logger: Logger;
  config: AgentLoopConfig;
  /** Lifecycle hooks; the loop fires PreCompact + the blocking Stop through this. */
  hooks?: HookBus;
  /** Between-turns steering queue; drained after each tool turn (default: none). */
  steering?: SteeringQueue;
  /** Spawn a sub-agent (threaded into the Task tool's ToolContext). */
  spawn?: ToolContext["spawn"];
  /** Nesting depth for this run; 0 = main agent. */
  depth?: number;
  /** Directory for spilled oversized tool output (threaded into ToolContext). */
  spillDir?: string;
  /** Debug/test seam: invoked with the immutable LoopState at the top of each iteration. */
  onLoopState?: (state: LoopState) => void;
}

export async function runAgentLoop(
  session: SessionState,
  userPrompt: string,
  workspace: Workspace,
  deps: AgentLoopDeps,
  emit: EventSink,
  signal: AbortSignal,
): Promise<AgentRunResult> {
  const { gateway, registry, executor, contextManager, ledger, sandbox, memory, clock, logger, config } = deps;
  // Immutable per-run snapshot (system prompt, project rules, tool schemas, effort knobs).
  const loop = buildLoopConfig(config, registry, workspace.root);
  const toolSchemas = loop.tools;
  const projectRules = loop.projectRules;
  const system = loop.system;
  const thinking = loop.thinking;
  const budget = loop.thinkingBudget;

  emit({
    type: "system",
    subtype: "init",
    sessionId: session.id,
    model: gateway.model,
    tools: registry.names(),
    maxTurns: loop.maxTurns,
    contextTokens: loop.contextTokens,
  });

  session.messages.push({ role: "user", content: userPrompt });
  session.status = "running";

  let stopReason: StopReason = null;
  let state: LoopState = initialLoopState();
  const denials = new DenialTracker();

  // Single finish site: every exit derives its public subtype from a Terminal.
  const finish = (terminal: Terminal, summary: string): AgentRunResult => {
    // Backfill synthetic tool_results for any orphaned tool_use (a non-completed exit
    // right after a tool-call turn), so the persisted transcript stays API-valid on resume.
    const last = session.messages[session.messages.length - 1];
    if (last?.role === "assistant" && last.toolCalls.length > 0) {
      session.messages.push({ role: "tool", results: ToolExecutor.syntheticResults(last.toolCalls) });
    }
    const subtype = terminalToSubtype(terminal);
    session.status = subtype === "success" ? "done" : subtype === "cancelled" ? "idle" : "error";
    const result: AgentRunResult = {
      subtype,
      numTurns: session.turns,
      sessionId: session.id,
      stopReason,
      totalCostUsd: session.costUsd,
      usage: session.usage,
      summary,
    };
    emit({ type: "result", ...result });
    return result;
  };

  while (true) {
    deps.onLoopState?.(state);
    if (signal.aborted) return finish({ reason: "aborted" }, "Run cancelled.");

    try {
      await contextManager.maybeCompact(
        session,
        {
          system,
          projectRules,
          tools: toolSchemas,
          realInputTokens: session.lastRealInputTokens,
          ledger,
          workspace,
          onPreCompact: deps.hooks
            ? () => deps.hooks!.runPreCompact({ sessionId: session.id, trigger: "auto" }).catch(() => {})
            : undefined,
        },
        emit,
        signal,
      );
    } catch (err) {
      if (err instanceof CompactionThrashError) {
        emit({ type: "notice", level: "error", message: err.message });
        return finish({ reason: "compaction_thrash" }, err.message);
      }
      throw err;
    }

    const request = assembleRequest({
      system,
      projectRules,
      messages: session.messages,
      tools: toolSchemas,
      maxOutputTokens: 0, // placeholder; sized below from the live input estimate
      temperature: loop.temperature,
      thinking,
      thinkingBudget: budget,
    });
    // Unleash output: hand the model up to its full maximum, shrinking only so this turn's
    // input + output fit the context window. (Output is never pinned to a small fixed cap;
    // effort controls thinking depth, not output length.)
    request.maxOutputTokens = outputBudget(loop.contextTokens, estimateRequestTokens(request), loop.maxOutputCap);

    let response: ModelResponse;
    try {
      response = gateway.stream
        ? await gateway.stream(request, signal, {
            onText: (chunk) => {
              if (chunk) emit({ type: "assistant_delta", text: chunk });
            },
            onReasoning: (chunk) => {
              if (chunk) emit({ type: "reasoning_delta", text: chunk });
            },
            onToolArgs: (chunk) => {
              if (chunk) emit({ type: "tool_args_delta", text: chunk });
            },
            onToolCall: (call) =>
              emit({ type: "tool_call", id: call.id, name: call.name, input: call.input }),
            onRetry: (info) => emit({ type: "api_retry", ...info }),
          })
        : await gateway.complete(request, signal);
    } catch (err) {
      if (signal.aborted) return finish({ reason: "aborted" }, "Run cancelled.");
      // Reactive compaction: the provider rejected the request as too long. Compact
      // once and retry; a second overflow (guard set) is terminal.
      if (err instanceof ContextOverflowError) {
        if (state.hasReactiveCompacted) {
          emit({ type: "notice", level: "error", message: "Context overflow persisted after compaction." });
          return finish({ reason: "context_overflow" }, err.message);
        }
        emit({ type: "notice", level: "warn", message: "Request too long; compacting and retrying once." });
        await contextManager.compactNow(session, { system, projectRules, tools: toolSchemas, ledger, workspace }, emit, signal);
        state = { ...state, transition: { reason: "reactive_compact_retry" }, hasReactiveCompacted: true };
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      logger.error("model gateway failed", { message });
      emit({ type: "notice", level: "error", message: `Model call failed: ${message}` });
      return finish({ reason: "model_error", error: err }, message);
    }

    stopReason = response.stopReason;
    session.costUsd += response.costUsd;
    session.usage.inputTokens += response.usage.inputTokens;
    session.usage.outputTokens += response.usage.outputTokens;
    // Authoritative count for the NEXT turn's compaction gate (beats the heuristic).
    session.lastRealInputTokens = response.usage.inputTokens;

    // Output-truncation recovery: the model hit its (already-maximal) output budget mid-answer
    // with no tool calls. The budget is sized to the whole remaining window, so there's nothing
    // to escalate to — keep the partial answer and nudge the model to resume in smaller pieces
    // (the next turn's budget is recomputed, and compaction frees input headroom if needed).
    if (response.toolCalls.length === 0 && response.stopReason === "max_tokens" && state.recoveryCount < 3) {
      session.messages.push({ role: "assistant", content: response.text, reasoning: response.reasoning, toolCalls: [] });
      emit({ type: "assistant", text: response.text, reasoning: response.reasoning, toolCalls: [] });
      session.messages.push({
        role: "user",
        content: "Output token limit hit. Resume directly — no apology, no recap. Pick up mid-thought; break the remaining work into smaller pieces.",
      });
      emit({ type: "notice", level: "warn", message: "Output truncated; asked the model to resume in smaller pieces." });
      state = { ...state, transition: { reason: "output_truncation_recovery", attempt: state.recoveryCount + 1 }, recoveryCount: state.recoveryCount + 1 };
      continue;
    }

    session.messages.push({
      role: "assistant",
      content: response.text,
      reasoning: response.reasoning,
      toolCalls: response.toolCalls,
    });
    emit({ type: "assistant", text: response.text, reasoning: response.reasoning, toolCalls: response.toolCalls });
    emit({
      type: "budget",
      ...computeBudget(loop.contextTokens, response.usage.inputTokens),
      cacheReadTokens: response.usage.cacheReadTokens,
      cacheCreationTokens: response.usage.cacheCreationTokens,
    });

    if (response.toolCalls.length === 0) {
      if (response.stopReason === "max_tokens") {
        emit({ type: "notice", level: "warn", message: "Output may be truncated — the response hit the output-token limit." });
      }
      // Blocking Stop hook: it may force one more turn (a "re-think loop"). Capped at
      // 3 continuations so a misbehaving hook can't loop forever.
      if (deps.hooks && state.stopBlocks < 3) {
        const stop = await deps.hooks.runStop({ sessionId: session.id, stopReason }).catch(() => null);
        if (stop && !stop.preventContinuation && stop.blockingErrors.length > 0) {
          for (const msg of stop.blockingErrors) session.messages.push({ role: "user", content: msg });
          emit({ type: "notice", level: "info", message: "A Stop hook requested more work; continuing." });
          state = { ...state, transition: { reason: "stop_hook_blocking" }, stopBlocks: state.stopBlocks + 1 };
          continue;
        }
      }
      return finish({ reason: "completed" }, response.text.trim() || "Done.");
    }

    session.turns += 1;
    // Both caps are OPT-IN safety nets (off by default): turns and budget are crude proxies
    // that throttle a big project's exploration, so they only trip when explicitly configured
    // (env AGENT_MAX_TURNS / AGENT_MAX_BUDGET_USD). The real backstops are the user's Esc, the
    // context-overflow / compaction-thrash terminals, and the denial-loop nudge.
    if (loop.maxTurns !== undefined && session.turns > loop.maxTurns) {
      const message = `Reached the maximum of ${loop.maxTurns} tool-use turns.`;
      emit({ type: "notice", level: "warn", message });
      return finish({ reason: "max_turns" }, message);
    }
    if (loop.maxBudgetUsd !== undefined && session.costUsd > loop.maxBudgetUsd) {
      const message = `Reached the budget cap of $${loop.maxBudgetUsd.toFixed(2)}.`;
      emit({ type: "notice", level: "warn", message });
      return finish({ reason: "max_budget" }, message);
    }

    const ctx: ToolContext = {
      sessionId: session.id,
      workspace,
      ledger,
      sandbox,
      memory,
      emit,
      signal,
      logger,
      clock,
      spawn: deps.spawn,
      depth: deps.depth ?? 0,
      spillDir: deps.spillDir,
    };
    const results = await executor.executeTurn(response.toolCalls, ctx);
    session.messages.push({ role: "tool", results });

    // Denial-loop protection: if the model keeps getting tool calls rejected, nudge it
    // to change approach instead of thrashing to the turn cap.
    if (results.some((r) => !r.isError)) denials.recordSuccess();
    if (results.some((r) => r.denied) && !results.some((r) => !r.isError)) denials.recordDenial();
    if (denials.shouldFallbackToPrompting()) {
      session.messages.push({
        role: "user",
        content: "Your previous tool call(s) were rejected. Do not retry the same action — change your approach, or ask the user how they'd like to proceed.",
      });
      emit({ type: "notice", level: "warn", message: "Repeated tool denials — asked the model to change approach." });
      denials.reset();
    }

    // Steering: fold any user input typed mid-run into the transcript for the next turn.
    const steered = deps.steering?.drain() ?? [];
    for (const msg of steered) session.messages.push({ role: "user", content: msg });
    if (steered.length > 0) emit({ type: "notice", level: "info", message: `(steering) added ${steered.length} message(s) to the conversation.` });

    // Continue point: rebuild state immutably (never mutate in place) so recovery
    // branches added later can gate on the previous transition without aliasing.
    state = { ...state, turns: session.turns, transition: { reason: "next_turn" } };
  }
}
