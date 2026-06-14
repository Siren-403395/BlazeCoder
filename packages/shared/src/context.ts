/**
 * Context-composition report — the per-block breakdown the `/context` command shows
 * so the window stops being a single opaque ratio. The numbers are an ESTIMATE
 * (the same char-heuristic the loop uses pre-first-call); the model only ever
 * returns one aggregate input-token count, so a block-level split cannot be exact.
 * The report therefore carries BOTH the estimated composition and, when known, the
 * server's authoritative total, and the renderer labels them honestly.
 *
 * Produced by `computeContextBreakdown` / `AgentRuntime.contextReport` in
 * @zephyrcode/core; consumed by the TUI (and anything else) for display only.
 */

/** The distinct slices of a model request, in assembly order. */
export type ContextBlockKind = "system" | "tools" | "rules" | "memory" | "history" | "toolResults";

export interface ContextBlock {
  kind: ContextBlockKind;
  /** Estimated tokens this block contributes (heuristic, padded like the loop's estimate). */
  tokens: number;
}

export interface ContextReport {
  /** Per-block estimated token shares, in assembly order. */
  blocks: ContextBlock[];
  /** Sum of the block estimates (≈ the loop's estimateRequestTokens for this transcript). */
  estimatedTotal: number;
  /** The model's full context window. */
  contextTokens: number;
  /** The server's authoritative input-token count from the last turn, if one has happened. */
  realUsedTokens?: number;
  /** True when the transcript head is a compaction summary (so the user knows history was compacted). */
  summarized: boolean;
}
