/**
 * ContextManager — graduated, cheapest-first compaction (Mechanism A + C):
 *   1. clear old tool RESULTS in place (no LLM call)
 *   2. only if still over budget, LLM-summarize history into one summary block
 *   3. circuit breaker: if summarization stops freeing meaningful space, throw a
 *      CompactionThrashError instead of looping forever.
 */

import type { Clock, EventSink, Logger, ModelGateway, SessionState, ToolSchema, Workspace } from "../ports";
import type { ReadLedger } from "../workspace/ledger";
import { TOOL_NAMES } from "../tools/toolNames";
import { assembleRequest, estimateRequestTokens } from "./sessionContext";
import { buildPostCompactFileMessage, buildSummaryRequest } from "./rehydration";

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

/**
 * Tool results safe to clear: bulky, regenerable read/search/shell output. Edit/Write
 * confirmations are NOT cleared — they're cheap and a useful record of what changed.
 */
const COMPACTABLE = new Set<string>([TOOL_NAMES.read, TOOL_NAMES.bash, TOOL_NAMES.grep, TOOL_NAMES.glob]);

function isClearedMarker(content: string): boolean {
  return /result cleared to save context\]\s*$/.test(content);
}

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
      /** Read-ledger + workspace enable post-summarization fresh-file rehydration. */
      ledger?: ReadLedger;
      workspace?: Workspace;
      /** Fired once, right before any compaction work happens (PreCompact lifecycle hook). */
      onPreCompact?: () => void | Promise<void>;
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

    // About to compact — give PreCompact hooks a chance (e.g. to snapshot state).
    await params.onPreCompact?.();

    // Stage 1 — clear old tool results (deterministic, no LLM). The transcript is now
    // mutated so the real count is stale; fall back to the estimate.
    const clearedIds = this.clearOldToolResults(session);
    let after = this.estimate(session, params);
    if (after < compactAt) {
      if (clearedIds.length > 0) {
        emit({
          type: "compact_boundary",
          reason: `cleared ${clearedIds.length} old tool result(s)`,
          tokensBefore: current,
          tokensAfter: after,
          clearedToolUseIds: clearedIds,
        });
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
    await this.rehydrateFiles(session, params.ledger, params.workspace);
    after = this.estimate(session, params);
    emit({
      type: "compact_boundary",
      reason: "summarized conversation history",
      tokensBefore: before,
      tokensAfter: after,
      clearedToolUseIds: clearedIds.length ? clearedIds : undefined,
    });

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

  /**
   * After summarizing, the model retains only prose mentions of the files it was
   * editing. Re-read the recently-read files FRESH and inject them right after the
   * summary, then clear the ledger so the next Edit must re-read (defends against
   * a file changing between rehydration and the edit).
   */
  private async rehydrateFiles(session: SessionState, ledger?: ReadLedger, workspace?: Workspace): Promise<void> {
    if (!ledger || !workspace) return;
    if (session.messages[0]?.role !== "summary") return; // summarize() didn't run
    const tail = session.messages.slice(1);
    const fileMsg = await buildPostCompactFileMessage(ledger, workspace, tail);
    if (fileMsg) session.messages.splice(1, 0, fileMsg);
    ledger.clear();
  }

  /** Clear old, regenerable tool results in place. Returns the toolUseIds cleared. */
  private clearOldToolResults(session: SessionState): string[] {
    const toolMsgIndexes = session.messages
      .map((m, i) => (m.role === "tool" ? i : -1))
      .filter((i) => i >= 0);
    // Always keep the most-recent tool message(s) verbatim — floor at 1.
    const keepRecent = Math.max(1, this.config.keepRecentToolResults);
    const cutoff = toolMsgIndexes.slice(0, Math.max(0, toolMsgIndexes.length - keepRecent));
    const cleared: string[] = [];
    for (const idx of cutoff) {
      const msg = session.messages[idx];
      if (msg && msg.role === "tool") {
        for (const result of msg.results) {
          if (!COMPACTABLE.has(result.toolName)) continue; // keep Edit/Write confirmations
          if (isClearedMarker(result.content)) continue; // skip already-cleared
          result.content = `[${result.toolName} result cleared to save context]`;
          cleared.push(result.toolUseId);
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
