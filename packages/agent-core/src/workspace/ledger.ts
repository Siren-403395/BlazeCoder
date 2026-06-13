/**
 * Read-before-edit ledger — the invariant that makes blind edits impossible.
 *
 * Read records each file's stamp (mtime + size) when the agent reads it. Edit and
 * Write (overwrite) consult the ledger: a file that was never read, or that
 * changed on disk since it was read (an external edit), is rejected with an
 * actionable error so the agent re-reads instead of clobbering. After a
 * successful write the tool re-stamps the file, so the agent's own sequential
 * edits never trip the staleness check.
 */

import type { FileStamp } from "../ports";

export type { FileStamp };

export class ReadLedger {
  private readonly seen = new Map<string, FileStamp>();

  /** Mark a file as read (or freshly written) with its current stamp. */
  record(absPath: string, stamp: FileStamp): void {
    // Re-insert so Map iteration order tracks recency (most-recently-read last).
    this.seen.delete(absPath);
    this.seen.set(absPath, stamp);
  }

  /** Paths read this run, most-recent first (for post-compaction file rehydration). */
  recentlyReadPaths(limit?: number): string[] {
    const all = [...this.seen.keys()].reverse();
    return limit === undefined ? all : all.slice(0, Math.max(0, limit));
  }

  /** Drop all read stamps (e.g. after compaction, so the next Edit must re-read). */
  clear(): void {
    this.seen.clear();
  }

  has(absPath: string): boolean {
    return this.seen.has(absPath);
  }

  get(absPath: string): FileStamp | undefined {
    return this.seen.get(absPath);
  }

  forget(absPath: string): void {
    this.seen.delete(absPath);
  }

  /** True if `current` differs from the recorded stamp (file changed since read). */
  isStale(absPath: string, current: FileStamp): boolean {
    const prev = this.seen.get(absPath);
    if (!prev) return false;
    return prev.mtimeMs !== current.mtimeMs || prev.size !== current.size;
  }
}
