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
  /** Fraction of context at which we begin clearing old tool results. */
  clearThreshold: number;
  /** Fraction at which we escalate to LLM summarization. */
  compactThreshold: number;
  /** Most-recent tool-result messages kept verbatim. */
  keepRecentToolResults: number;
  /** Recent messages preserved when summarizing the head. */
  keepRecentMessages: number;
  /** Consecutive low-yield summarizations before giving up. */
  maxThrash: number;
}

export const DEFAULT_COMPACTION: CompactionConfig = {
  contextTokens: 65_536,
  clearThreshold: 0.6,
  compactThreshold: 0.8,
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

  async maybeCompact(
    session: SessionState,
    params: { system: string; userRules?: string; tools: ToolSchema[] },
    emit: EventSink,
    signal: AbortSignal,
  ): Promise<void> {
    const estimate = () =>
      estimateRequestTokens(
        assembleRequest({
          system: params.system,
          project: session.project,
          userRules: params.userRules,
          messages: session.messages,
          tools: params.tools,
        }),
      );

    let before = estimate();
    this.logger.debug("compaction:check", { at: this.clock.now(), estimate: before, messages: session.messages.length });
    if (before < this.config.clearThreshold * this.config.contextTokens) {
      this.thrash = 0;
      return;
    }

    // Stage 1 — clear old tool results (deterministic, no LLM).
    const cleared = this.clearOldToolResults(session);
    let after = estimate();
    if (after < this.config.compactThreshold * this.config.contextTokens) {
      if (cleared > 0) {
        emit({ type: "compact_boundary", reason: `cleared ${cleared} old tool result(s)`, tokensBefore: before, tokensAfter: after });
      }
      this.thrash = 0;
      return;
    }

    // Stage 2 — LLM summarization.
    if (!this.gateway) {
      emit({ type: "notice", level: "warn", message: "Context is large but no summarizer is configured." });
      return;
    }
    before = after;
    await this.summarize(session, signal);
    after = estimate();
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
