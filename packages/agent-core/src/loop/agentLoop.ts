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
  Workspace,
} from "../ports";
import { assembleRequest, computeBudget } from "../context/sessionContext";
import { CompactionThrashError, ContextManager } from "../context/compaction";
import { resolveEffort, type Effort } from "../effort";
import { buildProjectRules } from "../memory/projectRules";
import { buildSystemPrompt } from "../prompts";
import type { ReadLedger } from "../workspace/ledger";
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
  const { thinking, budget, maxOutputTokens } = resolveEffort(config.effort, config.maxOutputTokens);

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

  const finish = (subtype: ResultSubtype, summary: string): AgentRunResult => {
    session.status = subtype === "success" ? "done" : subtype === "cancelled" ? "idle" : "error";
    emit({
      type: "result",
      subtype,
      numTurns: session.turns,
      sessionId: session.id,
      stopReason,
      totalCostUsd: session.costUsd,
      usage: session.usage,
      summary,
    });
    return {
      subtype,
      numTurns: session.turns,
      sessionId: session.id,
      stopReason,
      totalCostUsd: session.costUsd,
      usage: session.usage,
      summary,
    };
  };

  while (true) {
    if (signal.aborted) return finish("cancelled", "Run cancelled.");

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
        },
        emit,
        signal,
      );
    } catch (err) {
      if (err instanceof CompactionThrashError) {
        emit({ type: "notice", level: "error", message: err.message });
        return finish("error_compaction_thrash", err.message);
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
      if (signal.aborted) return finish("cancelled", "Run cancelled.");
      const message = err instanceof Error ? err.message : String(err);
      logger.error("model gateway failed", { message });
      emit({ type: "notice", level: "error", message: `Model call failed: ${message}` });
      return finish("error_during_execution", message);
    }

    stopReason = response.stopReason;
    session.costUsd += response.costUsd;
    session.usage.inputTokens += response.usage.inputTokens;
    session.usage.outputTokens += response.usage.outputTokens;
    // Authoritative count for the NEXT turn's compaction gate (beats the heuristic).
    session.lastRealInputTokens = response.usage.inputTokens;

    session.messages.push({
      role: "assistant",
      content: response.text,
      reasoning: response.reasoning,
      toolCalls: response.toolCalls,
    });
    emit({ type: "assistant", text: response.text, reasoning: response.reasoning, toolCalls: response.toolCalls });
    emit({ type: "budget", ...computeBudget(config.contextTokens, response.usage.inputTokens) });

    if (response.toolCalls.length === 0) {
      return finish("success", response.text.trim() || "Done.");
    }

    session.turns += 1;
    if (session.turns > config.maxTurns) {
      const message = `Reached the maximum of ${config.maxTurns} tool-use turns.`;
      emit({ type: "notice", level: "warn", message });
      return finish("error_max_turns", message);
    }
    if (session.costUsd > config.maxBudgetUsd) {
      const message = `Reached the budget cap of $${config.maxBudgetUsd.toFixed(2)}.`;
      emit({ type: "notice", level: "warn", message });
      return finish("error_max_budget_usd", message);
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
    };
    const results = await executor.executeTurn(response.toolCalls, ctx);
    session.messages.push({ role: "tool", results });
  }
}
