/**
 * Loop state machine — the typed vocabulary the agent loop reduces over.
 *
 * Every iteration ends in either a Terminal (stop the run) or a Continue (re-enter
 * the loop, carrying a breadcrumb so recovery paths can gate on WHY we re-entered
 * and never spiral). The loop keeps one immutable LoopState, rebuilt at each
 * continue point, and resolves to a Terminal at a SINGLE finish site that derives
 * the external ResultSubtype — so the public contract is unchanged while the
 * internals become a testable reducer. Recovery branches (output-truncation,
 * reactive-compaction) land in later tasks and key off `transition.reason`.
 */

import type { ResultSubtype } from "@coding-agent/shared";

export type Terminal =
  | { reason: "completed" }
  | { reason: "model_error"; error?: unknown }
  | { reason: "aborted" }
  | { reason: "max_turns" }
  | { reason: "max_budget" }
  | { reason: "compaction_thrash" }
  | { reason: "context_overflow" };

export type Continue =
  | { reason: "next_turn" }
  | { reason: "output_truncation_recovery"; attempt: number }
  | { reason: "reactive_compact_retry" }
  | { reason: "stop_hook_blocking" };

export interface LoopState {
  /** Tool-use turns taken (mirrors session.turns; rebuilt, never mutated in place). */
  turns: number;
  /** Why the loop re-entered — the breadcrumb recovery branches gate on. */
  transition: Continue;
  /** Output-truncation recovery attempts used so far (cap prevents loops). */
  recoveryCount: number;
  /** Blocking-Stop re-think continuations used (cap prevents an infinite re-think loop). */
  stopBlocks: number;
  /** Whether a reactive compaction has already been retried this run. */
  hasReactiveCompacted: boolean;
}

export function initialLoopState(): LoopState {
  return { turns: 0, transition: { reason: "next_turn" }, recoveryCount: 0, stopBlocks: 0, hasReactiveCompacted: false };
}

/** Map a Terminal to the public ResultSubtype (the external contract is unchanged). */
export function terminalToSubtype(terminal: Terminal): ResultSubtype {
  switch (terminal.reason) {
    case "completed":
      return "success";
    case "max_turns":
      return "error_max_turns";
    case "max_budget":
      return "error_max_budget_usd";
    case "compaction_thrash":
      return "error_compaction_thrash";
    case "aborted":
      return "cancelled";
    case "model_error":
    case "context_overflow":
      return "error_during_execution";
  }
}
