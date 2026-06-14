/**
 * InMemoryWorkspace — a virtual filesystem rooted at "/". Used by tests and
 * subagents that should not touch real disk. Implements the same async Workspace
 * port as FileSystemWorkspace, including a monotonic mtime so the read-before-edit
 * ledger's staleness check is exercised the same way it is on real disk.
 */

import { inferLanguage, type ProjectFile } from "@zephyrcode/shared";
import type { FileStamp, ReadFile, Workspace } from "../ports";
import { isWithin, resolveWithin } from "./boundary";

export class InMemoryWorkspace implements Workspace {
  readonly root = "/";
  private readonly files = new Map<string, ProjectFile>();
  private readonly stamps = new Map<string, FileStamp>();
  private tick = 0;

  constructor(seed: ProjectFile[] = []) {
    for (const f of seed) this.writeSync(f);
  }

  private writeSync(file: ProjectFile): void {
    this.files.set(file.path, { ...file });
    this.stamps.set(file.path, { mtimeMs: ++this.tick, size: file.content.length });
  }

  resolve(inputPath: string): string {
    return resolveWithin([this.root], this.root, inputPath);
  }

  isWritable(absPath: string): boolean {
    return isWithin(this.root, absPath);
  }

  async read(absPath: string): Promise<ReadFile | null> {
    const file = this.files.get(absPath);
    if (!file) return null;
    const stamp = this.stamps.get(absPath) ?? { mtimeMs: 0, size: file.content.length };
    return { ...file, stamp };
  }

  async write(file: ProjectFile): Promise<void> {
    this.writeSync(file);
  }

  async delete(absPath: string): Promise<boolean> {
    this.stamps.delete(absPath);
    return this.files.delete(absPath);
  }

  async exists(absPath: string): Promise<boolean> {
    return this.files.has(absPath);
  }

  async stat(absPath: string): Promise<FileStamp | null> {
    return this.stamps.get(absPath) ?? null;
  }

  async walk(opts: { respectGitignore?: boolean; limit?: number } = {}): Promise<string[]> {
    const limit = opts.limit ?? 5000;
    return [...this.files.keys()].sort().slice(0, limit);
  }

  /** Test convenience: seed a file synchronously with an inferred language. */
  seed(path: string, content: string): void {
    this.writeSync({ path, language: inferLanguage(path), content });
  }
}
