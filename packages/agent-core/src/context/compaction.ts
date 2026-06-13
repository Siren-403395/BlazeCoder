/**
 * ContextManager — graduated, cheapest-first compaction (Mechanism A + C):
 *   1. clear old tool RESULTS in place (no LLM call)
 *   2. only if still over budget, LLM-summarize history into one summary block
 *   3. circuit breaker: if summarization stops freeing meaningful space, throw a
 *      CompactionThrashError instead of looping forever.
 */

import type { Clock, EventSink, Logger, ModelGateway, SessionState, ToolSchema } from "../ports";
import { assembleRequest, estimateRequestTokens } from "./sessionContext";
import { buildSummaryRequest } from "./rehydration";

export interface CompactionConfig {
  contextTokens: number;
  /** Added to the run's maxOutputTokens when reserving output headroom from the window. */
  outputReservePad: number;
  /** Cap on the reserved output headroom. */
  outputReserveCap: number;
  /** Fraction of the EFFECTIVE window (context minus output reserve) at which we clear old tool results. */
  clearThreshold: number;
  /** Headroom (tokens) below the effective window at which we escalate to LLM summarization. */
  bufferTokens: number;
  /** Most-recent tool-result messages kept verbatim. */
  keepRecentToolResults: number;
  /** Recent messages preserved when summarizing the head. */
  keepRecentMessages: number;
  /** Consecutive low-yield summarizations before giving up. */
  maxThrash: number;
}

export const DEFAULT_COMPACTION: CompactionConfig = {
  contextTokens: 65_536,
  outputReservePad: 15_000,
  outputReserveCap: 20_000,
  clearThreshold: 0.7,
  bufferTokens: 13_000,
  keepRecentToolResults: 3,
  keepRecentMessages: 4,
  maxThrash: 3,
};

export class CompactionThrashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompactionThrashError";
  }
}

const CLEARED_MARKER = "[tool result cleared to save context]";

export class ContextManager {
  private thrash = 0;

  constructor(
    private readonly config: CompactionConfig,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly gateway?: ModelGateway,
  ) {}

  /** Effective usable window = context minus the output/framing reserve. */
  private effectiveWindow(maxOutputTokens: number): number {
    const reserve = Math.min(maxOutputTokens + this.config.outputReservePad, this.config.outputReserveCap);
    return Math.max(1, this.config.contextTokens - reserve);
  }

  private estimate(
    session: SessionState,
    params: { system: string; projectRules: string; tools: ToolSchema[] },
  ): number {
    return estimateRequestTokens(
      assembleRequest({
        system: params.system,
        projectRules: params.projectRules,
        messages: session.messages,
        tools: params.tools,
      }),
    );
  }

  async maybeCompact(
    session: SessionState,
    params: {
      system: string;
      projectRules: string;
      tools: ToolSchema[];
      /** The run's output budget; sizes the reserved headroom. */
      maxOutputTokens?: number;
      /** The server's authoritative input-token count from the previous turn, if any. */
      realInputTokens?: number;
    },
    emit: EventSink,
    signal: AbortSignal,
  ): Promise<void> {
    const effective = this.effectiveWindow(params.maxOutputTokens ?? 8000);
    const clearAt = effective * this.config.clearThreshold;
    const compactAt = Math.max(clearAt, effective - this.config.bufferTokens);

    // Authoritative real count first; the char-heuristic is only the pre-first-call fallback.
    const current = params.realInputTokens ?? this.estimate(session, params);
    this.logger.debug("compaction:check", {
      at: this.clock.now(),
      tokens: current,
      real: params.realInputTokens !== undefined,
      clearAt,
      compactAt,
      messages: session.messages.length,
    });
    if (current < clearAt) {
      this.thrash = 0;
      return;
    }

    // Stage 1 — clear old tool results (deterministic, no LLM). The transcript is now
    // mutated so the real count is stale; fall back to the estimate.
    const cleared = this.clearOldToolResults(session);
    let after = this.estimate(session, params);
    if (after < compactAt) {
      if (cleared > 0) {
        emit({ type: "compact_boundary", reason: `cleared ${cleared} old tool result(s)`, tokensBefore: current, tokensAfter: after });
      }
      this.thrash = 0;
      return;
    }

    // Stage 2 — LLM summarization.
    if (!this.gateway) {
      emit({ type: "notice", level: "warn", message: "Context is large but no summarizer is configured." });
      return;
    }
    const before = after;
    await this.summarize(session, signal);
    after = this.estimate(session, params);
    emit({ type: "compact_boundary", reason: "summarized conversation history", tokensBefore: before, tokensAfter: after });

    // Stage 3 — circuit breaker.
    if (before - after < 0.05 * this.config.contextTokens) {
      this.thrash += 1;
      if (this.thrash >= this.config.maxThrash) {
        throw new CompactionThrashError(
          "Context is too large to compact further. Start a new session or break the task into smaller sub-tasks.",
        );
      }
    } else {
      this.thrash = 0;
    }
  }

  private clearOldToolResults(session: SessionState): number {
    const toolMsgIndexes = session.messages
      .map((m, i) => (m.role === "tool" ? i : -1))
      .filter((i) => i >= 0);
    const cutoff = toolMsgIndexes.slice(0, Math.max(0, toolMsgIndexes.length - this.config.keepRecentToolResults));
    let cleared = 0;
    for (const idx of cutoff) {
      const msg = session.messages[idx];
      if (msg && msg.role === "tool") {
        for (const result of msg.results) {
          if (result.content !== CLEARED_MARKER) {
            result.content = CLEARED_MARKER;
            cleared += 1;
          }
        }
      }
    }
    return cleared;
  }

  private async summarize(session: SessionState, signal: AbortSignal): Promise<void> {
    const keep = this.config.keepRecentMessages;
    if (session.messages.length <= keep + 1) return;

    let split = session.messages.length - keep;
    // Don't let the tail begin with an orphaned tool-result message.
    while (split < session.messages.length && session.messages[split]?.role === "tool") split += 1;
    if (split <= 0 || split >= session.messages.length) return;

    const head = session.messages.slice(0, split);
    const tail = session.messages.slice(split);
    const response = await this.gateway!.complete(buildSummaryRequest(head), signal);
    const content = response.text.trim() || "(summary unavailable)";
    session.messages = [{ role: "summary", content }, ...tail];
  }
}
