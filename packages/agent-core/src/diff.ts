/**
 * Pure line-diff: turn a (before, after) pair into the structured FileDiff the TUI
 * renders. Host-agnostic and dependency-free so it is trivially unit-tested and reusable
 * (headless, web, …), and lives in core — not the view — so the rendering layer only paints.
 *
 * Strategy: trim the common prefix/suffix (so a localized edit in a large file stays cheap),
 * run an LCS diff over just the differing MIDDLE, then group the script into git-style hunks
 * carrying `context` unchanged lines around each change. Very large changes fall back to a
 * coarse block (all removed then all added) and are capped to a render budget.
 */

import type { DiffHunk, DiffLine, FileDiff } from "@blazecoder/shared";

export interface DiffOptions {
  /** Unchanged lines kept around each change (git default 3). */
  context?: number;
  /** Hard cap on diff lines emitted across all hunks; excess is dropped + truncated=true. */
  maxLines?: number;
}

/** Split into lines, treating "" as zero lines (a create diffs against an empty file). */
function toLines(text: string): string[] {
  return text.length === 0 ? [] : text.split("\n");
}

/**
 * LCS diff over two line arrays, offset so emitted line numbers are absolute (both arrays
 * share the trimmed prefix length). Bounded by the caller, which only passes the small middle.
 */
function lcsDiff(a: string[], b: string[], offset: number): DiffLine[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i:], b[j:]. Filled bottom-up.
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "context", text: a[i]!, oldLine: offset + i + 1, newLine: offset + j + 1 });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ kind: "del", text: a[i]!, oldLine: offset + i + 1 });
      i++;
    } else {
      out.push({ kind: "add", text: b[j]!, newLine: offset + j + 1 });
      j++;
    }
  }
  while (i < n) out.push({ kind: "del", text: a[i]!, oldLine: offset + i++ + 1 });
  while (j < m) out.push({ kind: "add", text: b[j]!, newLine: offset + j++ + 1 });
  return out;
}

/** Coarse fallback for huge middles: every removed line, then every added line. */
function blockDiff(a: string[], b: string[], offset: number): DiffLine[] {
  return [
    ...a.map((text, i): DiffLine => ({ kind: "del", text, oldLine: offset + i + 1 })),
    ...b.map((text, i): DiffLine => ({ kind: "add", text, newLine: offset + i + 1 })),
  ];
}

/** Group a flat diff script into hunks: each change plus `context` unchanged lines; gaps split. */
function toHunks(script: DiffLine[], context: number, maxLines: number): { hunks: DiffHunk[]; truncated: boolean } {
  // Mark every line within `context` of a change as "kept"; unmarked runs become hunk gaps.
  const keep = new Array<boolean>(script.length).fill(false);
  for (let i = 0; i < script.length; i++) {
    if (script[i]!.kind === "context") continue;
    for (let k = Math.max(0, i - context); k <= Math.min(script.length - 1, i + context); k++) keep[k] = true;
  }
  const hunks: DiffHunk[] = [];
  let current: DiffLine[] | null = null;
  let emitted = 0;
  let truncated = false;
  for (let i = 0; i < script.length; i++) {
    if (!keep[i]) {
      if (current) {
        hunks.push({ lines: current });
        current = null;
      }
      continue;
    }
    if (emitted >= maxLines) {
      truncated = true;
      break;
    }
    (current ??= []).push(script[i]!);
    emitted++;
  }
  if (current) hunks.push({ lines: current });
  return { hunks, truncated };
}

/**
 * Compute a structured diff between `before` and `after`. `op` flows straight through to
 * the result (the tool knows whether it created, overwrote, edited, or deleted).
 */
export function computeFileDiff(before: string, after: string, op: FileDiff["op"], opts: DiffOptions = {}): FileDiff {
  const context = opts.context ?? 3;
  const maxLines = opts.maxLines ?? 200;
  const a = toLines(before);
  const b = toLines(after);

  // Trim the common prefix, then the common suffix (never overlapping the prefix).
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }

  const aMid = a.slice(prefix, a.length - suffix);
  const bMid = b.slice(prefix, b.length - suffix);

  // Diff just the middle. Guard the O(n*m) LCS table; fall back to a coarse block when huge.
  const LCS_CELL_CAP = 250_000;
  const mid =
    aMid.length * bMid.length > LCS_CELL_CAP
      ? blockDiff(aMid, bMid, prefix)
      : lcsDiff(aMid, bMid, prefix);

  // Surround the middle with up to `context` unchanged lines from the trimmed prefix/suffix.
  const lead: DiffLine[] = [];
  for (let i = Math.max(0, prefix - context); i < prefix; i++) {
    lead.push({ kind: "context", text: a[i]!, oldLine: i + 1, newLine: i + 1 });
  }
  const aSuffixStart = a.length - suffix;
  const bSuffixStart = b.length - suffix;
  const trail: DiffLine[] = [];
  for (let k = 0; k < Math.min(context, suffix); k++) {
    trail.push({ kind: "context", text: a[aSuffixStart + k]!, oldLine: aSuffixStart + k + 1, newLine: bSuffixStart + k + 1 });
  }

  const script = [...lead, ...mid, ...trail];
  const added = script.reduce((n, l) => n + (l.kind === "add" ? 1 : 0), 0);
  const removed = script.reduce((n, l) => n + (l.kind === "del" ? 1 : 0), 0);
  const { hunks, truncated } = toHunks(script, context, maxLines);

  return { op, added, removed, hunks, truncated };
}
