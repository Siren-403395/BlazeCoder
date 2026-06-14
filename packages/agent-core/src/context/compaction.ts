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
import { assembleRequest, estimateMessageTokens, estimateRequestTokens } from "./sessionContext";
import { buildPostCompactFileMessage, buildSummaryRequest, isSubstantialNotes, stripAnalysis, truncateNotes } from "./rehydration";

export interface CompactionConfig {
  contextTokens: number;
  /** Tokens reserved from the window for the model's output — bounds how large input may grow. */
  outputReserveCap: number;
  /** Fraction of the EFFECTIVE window (context minus output reserve) at which we clear old tool results. */
  clearThreshold: number;
  /** Headroom (tokens) below the effective window at which we escalate to LLM summarization. */
  bufferTokens: number;
  /** Most-recent tool-result messages kept verbatim. */
  keepRecentToolResults: number;
  /** Recent messages preserved when summarizing the head (legacy fixed-count fallback). */
  keepRecentMessages: number;
  /** Consecutive low-yield summarizations before giving up. */
  maxThrash: number;
  /**
   * Token-floored keep-window for summarization. When set (the real runtime), the
   * kept tail expands back from the end until it holds at least summaryKeepMinTokens
   * AND summaryKeepMinMessages non-tool messages, capped at summaryKeepMaxTokens.
   * When unset, the fixed keepRecentMessages count is used (tests).
   */
  summaryKeepMinTokens?: number;
  summaryKeepMinMessages?: number;
  summaryKeepMaxTokens?: number;
}

export const DEFAULT_COMPACTION: CompactionConfig = {
  // DeepSeek-V4-Pro's full ~1M-token context window — we no longer cap it small.
  contextTokens: 1_048_576,
  // Keep ~64k free for output (output can still grow far larger when input is small — the
  // loop sizes max_tokens = min(model max, window − input) per turn). With a 1M window this
  // leaves a ~984k effective input window, so compaction stays rare and lossless until full.
  outputReserveCap: 64_000,
  clearThreshold: 0.7,
  bufferTokens: 24_000,
  keepRecentToolResults: 4,
  keepRecentMessages: 4,
  maxThrash: 3,
  summaryKeepMinTokens: 16_000,
  summaryKeepMinMessages: 5,
  summaryKeepMaxTokens: 96_000,
};

/** Outcome of a user-initiated /compact, so the caller can report precisely what changed. */
export interface ManualCompactResult {
  /** "empty": no session/messages to compact · "noop": nothing freed · "compacted": history/tools reduced. */
  status: "empty" | "noop" | "compacted";
  /** Estimated request tokens before compaction. */
  tokensBefore: number;
  /** Estimated request tokens after compaction. */
  tokensAfter: number;
  /** Number of old tool-result blocks cleared in place. */
  clearedCount: number;
  /** Whether the history head was summarized into a summary block. */
  summarized: boolean;
}

export class CompactionThrashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompactionThrashError";
  }
}

/** Thrown by the gateway adapter when the provider rejects a request for being too long. */
export class ContextOverflowError extends Error {
  constructor(message = "The request exceeded the model's context length.") {
    super(message);
    this.name = "ContextOverflowError";
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

/** Max consecutive summarize failures before we stop trying and tell the user to /clear. */
const MAX_SUMMARIZE_FAILURES = 3;
/** Attempts to summarize one head, truncating the oldest round each time the call overflows. */
const MAX_SUMMARIZE_TRUNCATIONS = 3;

/**
 * Drop the oldest API "round" (everything before the 2nd assistant message) so a
 * head that itself overflows the summarizer can be retried smaller. Returns the
 * input unchanged when it can't shrink (fewer than 2 rounds).
 */
export function truncateHeadForSummary(head: SessionState["messages"]): SessionState["messages"] {
  let assistants = 0;
  for (let i = 0; i < head.length; i++) {
    if (head[i]!.role === "assistant") {
      assistants += 1;
      if (assistants === 2) return head.slice(i);
    }
  }
  return head;
}

export class ContextManager {
  private thrash = 0;
  private consecutiveFailures = 0;

  constructor(
    private readonly config: CompactionConfig,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly gateway?: ModelGateway,
  ) {}

  /**
   * Effective usable INPUT window = context minus a reserved slice kept free for output.
   * The per-request output budget (set in the loop) can still grow up to the model max when
   * input is small; this reserve just guarantees there's always room for output, so it bounds
   * how large input may grow before we compact.
   */
  private effectiveWindow(): number {
    return Math.max(1, this.config.contextTokens - this.config.outputReserveCap);
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
      /** The server's authoritative input-token count from the previous turn, if any. */
      realInputTokens?: number;
      /** Read-ledger + workspace enable post-summarization fresh-file rehydration. */
      ledger?: ReadLedger;
      workspace?: Workspace;
      /** Fired once, right before any compaction work happens (PreCompact lifecycle hook). */
      onPreCompact?: () => void | Promise<void>;
      /** Live session notes; when substantial, used as the summary (no gateway call). */
      notes?: string;
    },
    emit: EventSink,
    signal: AbortSignal,
  ): Promise<void> {
    const effective = this.effectiveWindow();
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
        this.logger.info("compaction_done", { stage: "clear", tokensBefore: current, tokensAfter: after, cleared: clearedIds.length });
      }
      this.thrash = 0;
      return;
    }

    // Stage 2 — summarize. Live session notes (when populated) are a zero-cost summary
    // source; otherwise we call the gateway.
    const hasNotes = !!params.notes && isSubstantialNotes(params.notes);
    if (!this.gateway && !hasNotes) {
      emit({ type: "notice", level: "warn", message: "Context is large but no summarizer is configured." });
      return;
    }
    // Failure circuit breaker: if summarization keeps throwing, stop trying (the
    // cleared tool results above still freed some space) and tell the user.
    if (this.consecutiveFailures >= MAX_SUMMARIZE_FAILURES) {
      emit({
        type: "notice",
        level: "warn",
        message: "Summarization keeps failing; the context can't be compacted further. Use /clear to start a fresh session.",
      });
      return;
    }
    const before = after;
    try {
      await this.summarize(session, signal, { preTokens: before, clearedToolUseIds: clearedIds, notes: params.notes });
      this.consecutiveFailures = 0;
    } catch (err) {
      // Don't throw out of the loop — continue with cleared-but-unsummarized context.
      this.consecutiveFailures += 1;
      const message = err instanceof Error ? err.message : String(err);
      emit({
        type: "notice",
        level: "warn",
        message: `Summarization failed (${this.consecutiveFailures}/${MAX_SUMMARIZE_FAILURES}): ${message}. Continuing with cleared context.`,
      });
      return;
    }
    await this.rehydrateFiles(session, params.ledger, params.workspace);
    after = this.estimate(session, params);
    emit({
      type: "compact_boundary",
      reason: "summarized conversation history",
      tokensBefore: before,
      tokensAfter: after,
      clearedToolUseIds: clearedIds.length ? clearedIds : undefined,
    });
    this.logger.info("compaction_done", { stage: "summarize", tokensBefore: before, tokensAfter: after, cleared: clearedIds.length });

    // Stage 3 — low-yield circuit breaker.
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

  /**
   * Force a compaction NOW, ignoring thresholds — used for reactive recovery when the
   * provider rejects a request for being too long. Clears old tool results, then
   * summarizes + rehydrates (best-effort; shares the failure counter with maybeCompact).
   */
  async compactNow(
    session: SessionState,
    params: { system: string; projectRules: string; tools: ToolSchema[]; ledger?: ReadLedger; workspace?: Workspace },
    emit: EventSink,
    signal: AbortSignal,
  ): Promise<void> {
    const clearedIds = this.clearOldToolResults(session);
    if (!this.gateway || this.consecutiveFailures >= MAX_SUMMARIZE_FAILURES) {
      emit({ type: "compact_boundary", reason: "reactive compaction (cleared tool results)", tokensBefore: 0, tokensAfter: this.estimate(session, params), clearedToolUseIds: clearedIds.length ? clearedIds : undefined });
      return;
    }
    const before = this.estimate(session, params);
    try {
      await this.summarize(session, signal, { preTokens: before, clearedToolUseIds: clearedIds });
      this.consecutiveFailures = 0;
    } catch {
      this.consecutiveFailures += 1;
      return;
    }
    await this.rehydrateFiles(session, params.ledger, params.workspace);
    emit({
      type: "compact_boundary",
      reason: "reactive compaction (context overflow)",
      tokensBefore: before,
      tokensAfter: this.estimate(session, params),
      clearedToolUseIds: clearedIds.length ? clearedIds : undefined,
    });
  }

  /**
   * User-initiated compaction (the /compact command): compact NOW, ignoring the
   * size thresholds the passive path waits for. Clears old tool results, then
   * LLM-summarizes the history head (same machinery as the passive path, but the
   * boundary is marked compactType:"manual"). Best-effort — a summarize failure
   * leaves the cleared-but-unsummarized transcript and emits a notice. Returns what
   * changed so the caller can tell the user precisely. Emits a compact_boundary (the
   * ⟳ chip) only when something was actually freed.
   */
  async compactManually(
    session: SessionState,
    params: { system: string; projectRules: string; tools: ToolSchema[]; ledger?: ReadLedger; workspace?: Workspace; notes?: string },
    emit: EventSink,
    signal: AbortSignal,
  ): Promise<ManualCompactResult> {
    const before = this.estimate(session, params);
    const clearedIds = this.clearOldToolResults(session);

    // Summarize the head (manual = always attempt; ignore thresholds). Live notes, when
    // populated, are a zero-cost summary source; otherwise we call the gateway.
    let summarized = false;
    const hasNotes = !!params.notes && isSubstantialNotes(params.notes);
    if ((this.gateway || hasNotes) && this.consecutiveFailures < MAX_SUMMARIZE_FAILURES) {
      try {
        summarized = await this.summarize(session, signal, {
          preTokens: before,
          clearedToolUseIds: clearedIds,
          notes: params.notes,
          compactType: "manual",
        });
        this.consecutiveFailures = 0;
      } catch (err) {
        this.consecutiveFailures += 1;
        const message = err instanceof Error ? err.message : String(err);
        emit({ type: "notice", level: "warn", message: `Summarization failed: ${message}. Kept the cleared context.` });
      }
    }
    if (summarized) await this.rehydrateFiles(session, params.ledger, params.workspace);

    const after = this.estimate(session, params);
    const status: ManualCompactResult["status"] = summarized || clearedIds.length > 0 ? "compacted" : "noop";

    if (status === "compacted") {
      const parts: string[] = [];
      if (summarized) parts.push("summarized history");
      if (clearedIds.length) parts.push(`cleared ${clearedIds.length} tool result${clearedIds.length === 1 ? "" : "s"}`);
      emit({
        type: "compact_boundary",
        reason: `manual compaction (${parts.join(", ")})`,
        tokensBefore: before,
        tokensAfter: after,
        clearedToolUseIds: clearedIds.length ? clearedIds : undefined,
      });
      this.logger.info("compaction_done", { stage: "manual", tokensBefore: before, tokensAfter: after, cleared: clearedIds.length, summarized });
    }

    return { status, tokensBefore: before, tokensAfter: after, clearedCount: clearedIds.length, summarized };
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

  /**
   * The index where the kept tail begins. Token-floored window when configured
   * (expand back until ≥minTokens AND ≥minMessages non-tool messages, capped at
   * maxTokens); otherwise the fixed keepRecentMessages count.
   */
  private computeSplit(messages: SessionState["messages"]): number {
    const cfg = this.config;
    if (cfg.summaryKeepMaxTokens != null) {
      const minTokens = cfg.summaryKeepMinTokens ?? 10_000;
      const minMsgs = cfg.summaryKeepMinMessages ?? 5;
      let split = messages.length;
      let tokens = 0;
      let textMsgs = 0;
      for (let i = messages.length - 1; i >= 0; i--) {
        const mt = estimateMessageTokens(messages[i]!);
        if (tokens >= minTokens && textMsgs >= minMsgs) break;
        if (tokens + mt > cfg.summaryKeepMaxTokens) break;
        tokens += mt;
        if (messages[i]!.role !== "tool") textMsgs += 1;
        split = i;
      }
      return this.adjustSplit(messages, split);
    }
    return this.adjustSplit(messages, messages.length - cfg.keepRecentMessages);
  }

  /**
   * Move the split BACK so the kept tail never starts with an orphaned tool result:
   * a tool message's matching assistant tool_use must travel with it (DeepSeek
   * rejects an orphaned tool_result, just as it rejects an orphaned tool_use).
   */
  private adjustSplit(messages: SessionState["messages"], split: number): number {
    let s = Math.max(0, Math.min(split, messages.length));
    while (s > 0 && messages[s]?.role === "tool") s -= 1;
    return s;
  }

  private async summarize(
    session: SessionState,
    signal: AbortSignal,
    meta: { preTokens: number; clearedToolUseIds: string[]; notes?: string; compactType?: "auto" | "manual" },
  ): Promise<boolean> {
    const split = this.computeSplit(session.messages);
    if (split <= 0 || split >= session.messages.length) return false;

    const tail = session.messages.slice(split);
    let head = session.messages.slice(0, split);

    let content: string;
    if (meta.notes && isSubstantialNotes(meta.notes)) {
      // Zero-cost: the model's live notes ARE the summary (head-truncated). No gateway call.
      content = truncateNotes(meta.notes);
    } else {
      // Retry on overflow: if the summarize call itself fails, drop the oldest round
      // and try again with a smaller head, up to a cap. If it can't shrink, rethrow.
      let summary: string | undefined;
      for (let attempt = 0; attempt < MAX_SUMMARIZE_TRUNCATIONS; attempt++) {
        try {
          const response = await this.gateway!.complete(buildSummaryRequest(head), signal);
          summary = stripAnalysis(response.text) || "(summary unavailable)";
          break;
        } catch (err) {
          const smaller = truncateHeadForSummary(head);
          if (smaller.length >= head.length) throw err; // can't shrink further
          head = smaller;
        }
      }
      if (summary === undefined) throw new Error("summarization failed after truncation retries");
      content = summary;
    }

    session.messages = [
      {
        role: "summary",
        content,
        boundary: {
          compactType: meta.compactType ?? "auto",
          preTokens: meta.preTokens,
          clearedToolUseIds: meta.clearedToolUseIds.length ? meta.clearedToolUseIds : undefined,
        },
      },
      ...tail,
    ];
    return true;
  }
}
