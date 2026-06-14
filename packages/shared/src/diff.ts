/**
 * Structured line-diff types — the contract a `file_change` event carries so a host
 * (the TUI today, anything else tomorrow) can render a git-style diff WITHOUT the bulky
 * before/after content ever re-entering the transcript. The diff is computed once, at the
 * tool, by `computeFileDiff` in @blazecoder/core; consumers only render these shapes.
 */

/** A single rendered diff line. `context` lines are unchanged padding around a change. */
export interface DiffLine {
  kind: "add" | "del" | "context";
  text: string;
  /** 1-indexed line number in the OLD file (absent on pure additions). */
  oldLine?: number;
  /** 1-indexed line number in the NEW file (absent on pure deletions). */
  newLine?: number;
}

/** A contiguous run of diff lines (a change plus its surrounding context), git-hunk style. */
export interface DiffHunk {
  lines: DiffLine[];
}

/** A complete file diff: hunks plus the added/removed line tally and a truncation flag. */
export interface FileDiff {
  /** create = brand-new file · write = full overwrite · edit = in-place · delete = removed. */
  op: "create" | "write" | "edit" | "delete";
  added: number;
  removed: number;
  hunks: DiffHunk[];
  /** True when hunks were elided to stay within a render budget (very large changes). */
  truncated: boolean;
}
