/**
 * Minimal line diff (LCS) for the file viewer. Generated project files are
 * small, so an O(n·m) table is fine and keeps the implementation transparent.
 */

export type DiffRowType = "same" | "add" | "del";

export interface DiffRow {
  type: DiffRowType;
  text: string;
  /** 1-based line number in the previous file (del / same). */
  before?: number;
  /** 1-based line number in the next file (add / same). */
  after?: number;
}

export interface DiffStats {
  added: number;
  removed: number;
}

export function diffLines(prev: string, next: string): DiffRow[] {
  const a = prev.length ? prev.split("\n") : [];
  const b = next.length ? next.split("\n") : [];
  const n = a.length;
  const m = b.length;

  // LCS length table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: "same", text: a[i]!, before: i + 1, after: j + 1 });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      rows.push({ type: "del", text: a[i]!, before: i + 1 });
      i++;
    } else {
      rows.push({ type: "add", text: b[j]!, after: j + 1 });
      j++;
    }
  }
  while (i < n) rows.push({ type: "del", text: a[i]!, before: ++i });
  while (j < m) rows.push({ type: "add", text: b[j]!, after: ++j });
  return rows;
}

export function diffStats(rows: DiffRow[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const r of rows) {
    if (r.type === "add") added++;
    else if (r.type === "del") removed++;
  }
  return { added, removed };
}
