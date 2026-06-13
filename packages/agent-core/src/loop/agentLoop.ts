/**
 * The agent loop — the harness core. Deliberately dumb: gather context → call
 * model → execute tool calls → feed results back → repeat, until the model emits
 * no tool calls (model-decided done) or one of OUR caps trips. Permissions,
 * compaction, and persistence are sibling modules it calls into.
 */

import type { ResultSubtype, StopReason, TokenUsage } from "@coding-agent/shared";
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
import { assembleRequest, computeBudget } from "../context/sessionContext";
import { CompactionThrashError, ContextManager } from "../context/compaction";
import { escalateOutputTokens, resolveEffort, type Effort } from "../effort";
import { buildProjectRules } from "../memory/projectRules";
import { buildSystemPrompt } from "../prompts";
import { initialLoopState, terminalToSubtype } from "./transitions";
import type { LoopState, Terminal } from "./transitions";
import type { ReadLedger } from "../workspace/ledger";
import type { HookBus } from "../permissions/hooks";
import type { ToolContext } from "../tools/registry";
import type { ToolRegistry } from "../tools/registry";
import type { ToolExecutor } from "../tools/executor";

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
  maxTurns: number;
  maxBudgetUsd: number;
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
  const toolSchemas = registry.schemas();
  const projectRules = buildProjectRules({ root: workspace.root, userRules: config.userRules });
  const { thinking, budget } = resolveEffort(config.effort, config.maxOutputTokens);
  // Mutable: output-truncation recovery escalates this within the run.
  let maxOutputTokens = resolveEffort(config.effort, config.maxOutputTokens).maxOutputTokens;

  // Build the system prompt per-run: sections gate on the tools actually registered
  // and on this run's effort. Joined to one string here (DeepSeek takes one system
  // string); the sectioned shape stays internal to the builder.
  const system = buildSystemPrompt({
    toolNames: new Set(registry.names()),
    effort: config.effort,
    modePrompt: config.modePrompt,
    override: config.promptOverride,
    extra: config.extraInstructions,
    variant: config.promptVariant,
  }).join("\n\n");

  emit({
    type: "system",
    subtype: "init",
    sessionId: session.id,
    model: gateway.model,
    tools: registry.names(),
    maxTurns: config.maxTurns,
    contextTokens: config.contextTokens,
  });

  session.messages.push({ role: "user", content: userPrompt });
  session.status = "running";

  let stopReason: StopReason = null;
  let state: LoopState = initialLoopState();

  // Single finish site: every exit derives its public subtype from a Terminal.
  const finish = (terminal: Terminal, summary: string): AgentRunResult => {
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
          maxOutputTokens,
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
      maxOutputTokens,
      temperature: config.temperature,
      thinking,
      thinkingBudget: budget,
    });

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
            onToolCall: (call) =>
              emit({ type: "tool_call", id: call.id, name: call.name, input: call.input }),
            onRetry: (info) => emit({ type: "api_retry", ...info }),
          })
        : await gateway.complete(request, signal);
    } catch (err) {
      if (signal.aborted) return finish({ reason: "aborted" }, "Run cancelled.");
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

    // Output-truncation recovery: the model hit its output budget mid-answer with no
    // tool calls. Recover instead of mistaking the truncated text for a finished turn.
    if (response.toolCalls.length === 0 && response.stopReason === "max_tokens" && state.recoveryCount < 3) {
      const escalated = state.recoveryCount === 0 ? escalateOutputTokens(maxOutputTokens) : undefined;
      if (escalated) {
        // First time: silently retry the SAME request with a bigger budget (discard the
        // truncated turn — it never enters the transcript).
        maxOutputTokens = escalated;
        emit({ type: "notice", level: "info", message: `Output truncated; retrying with a larger output budget (${escalated} tokens).` });
        state = { ...state, transition: { reason: "output_truncation_recovery", attempt: state.recoveryCount + 1 }, recoveryCount: state.recoveryCount + 1 };
        continue;
      }
      // Already escalated (or at the ceiling): keep the partial work and nudge the model to resume.
      session.messages.push({ role: "assistant", content: response.text, reasoning: response.reasoning, toolCalls: [] });
      emit({ type: "assistant", text: response.text, reasoning: response.reasoning, toolCalls: [] });
      session.messages.push({
        role: "user",
        content: "Output token limit hit. Resume directly — no apology, no recap. Pick up mid-thought; break the remaining work into smaller pieces.",
      });
      emit({ type: "notice", level: "warn", message: "Output truncated again; asked the model to resume in smaller pieces." });
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
    emit({ type: "budget", ...computeBudget(config.contextTokens, response.usage.inputTokens) });

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
    if (session.turns > config.maxTurns) {
      const message = `Reached the maximum of ${config.maxTurns} tool-use turns.`;
      emit({ type: "notice", level: "warn", message });
      return finish({ reason: "max_turns" }, message);
    }
    if (session.costUsd > config.maxBudgetUsd) {
      const message = `Reached the budget cap of $${config.maxBudgetUsd.toFixed(2)}.`;
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
    };
    const results = await executor.executeTurn(response.toolCalls, ctx);
    session.messages.push({ role: "tool", results });

    // Steering: fold any user input typed mid-run into the transcript for the next turn.
    const steered = deps.steering?.drain() ?? [];
    for (const msg of steered) session.messages.push({ role: "user", content: msg });
    if (steered.length > 0) emit({ type: "notice", level: "info", message: `(steering) added ${steered.length} message(s) to the conversation.` });

    // Continue point: rebuild state immutably (never mutate in place) so recovery
    // branches added later can gate on the previous transition without aliasing.
    state = { ...state, turns: session.turns, transition: { reason: "next_turn" } };
  }
}
