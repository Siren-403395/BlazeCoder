/**
 * FileSystemWorkspace — the real filesystem, scoped to a canonical root (cwd) plus
 * any extra writable roots (--add-dir). Every path the agent supplies is resolved
 * lexically into the boundary (boundary.ts) AND realpath-checked here so a symlink
 * cannot smuggle a read or write outside the roots. Always-ignored directories
 * (.git, node_modules, ...) and, optionally, .gitignore are skipped during walks.
 */

import { mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { inferLanguage, type ProjectFile } from "@coding-agent/shared";
import type { FileStamp, ReadFile, Workspace } from "../ports";
import { isWithin, resolveWithin, WorkspaceBoundaryError } from "./boundary";
import { compileIgnore, isIgnored, type IgnoreRule } from "./gitignore";

const ALWAYS_IGNORE = new Set([
  ".git",
  "node_modules",
  ".turbo",
  "dist",
  "build",
  ".next",
  "coverage",
  ".cache",
  ".vite",
]);

const DEFAULT_WALK_LIMIT = 5000;

/** Resolve real (symlink-free) absolute path; fall back to lexical resolve if it does not exist yet. */
function canonical(p: string): string {
  try {
    return realpathSync(resolve(p));
  } catch {
    return resolve(p);
  }
}

export interface FileSystemWorkspaceOptions {
  /** The primary root (defaults to process.cwd()). */
  root: string;
  /** Additional writable roots beyond the primary root. */
  writableRoots?: string[];
}

export class FileSystemWorkspace implements Workspace {
  readonly root: string;
  private readonly roots: string[];
  private readonly writable: string[];

  constructor(opts: FileSystemWorkspaceOptions) {
    // Canonicalize roots so the boundary survives symlinked roots (e.g. macOS
    // /var -> /private/var, or a temp dir behind a symlink).
    this.root = canonical(opts.root);
    this.writable = [this.root, ...(opts.writableRoots ?? []).map(canonical)];
    // Reads are allowed across every root we may write to (no broader read root in V1).
    this.roots = [...this.writable];
  }

  resolve(inputPath: string): string {
    return resolveWithin(this.roots, this.root, inputPath);
  }

  isWritable(absPath: string): boolean {
    return this.writable.some((r) => isWithin(r, absPath));
  }

  /** Resolve symlinks on the nearest existing ancestor and assert containment. */
  private async assertRealWithin(absPath: string): Promise<void> {
    let cur = absPath;
    const tail: string[] = [];
    for (;;) {
      try {
        const real = await realpath(cur);
        const full = tail.length ? join(real, ...tail.slice().reverse()) : real;
        if (!this.roots.some((r) => isWithin(r, full))) {
          throw new WorkspaceBoundaryError(`Path resolves through a symlink outside the workspace: ${absPath}`);
        }
        return;
      } catch (err) {
        if (err instanceof WorkspaceBoundaryError) throw err;
        const parent = dirname(cur);
        if (parent === cur) return; // reached filesystem root without a symlink escape
        tail.push(basename(cur));
        cur = parent;
      }
    }
  }

  async read(absPath: string): Promise<ReadFile | null> {
    try {
      await this.assertRealWithin(absPath);
      const content = await readFile(absPath, "utf8");
      const s = await stat(absPath);
      return { path: absPath, language: inferLanguage(absPath), content, stamp: { mtimeMs: s.mtimeMs, size: s.size } };
    } catch (err) {
      if (err instanceof WorkspaceBoundaryError) throw err;
      return null;
    }
  }

  async write(file: ProjectFile): Promise<void> {
    if (!this.isWritable(file.path)) {
      throw new WorkspaceBoundaryError(`Path is outside the writable workspace: ${file.path}`);
    }
    await this.assertRealWithin(file.path);
    await mkdir(dirname(file.path), { recursive: true });
    // Re-check after mkdir: a concurrently-swapped symlink could have made mkdir
    // create directories outside the boundary (TOCTOU). Now the parent exists,
    // so realpath resolves the true target.
    await this.assertRealWithin(file.path);
    await writeFile(file.path, file.content, "utf8");
  }

  async delete(absPath: string): Promise<boolean> {
    if (!this.isWritable(absPath)) {
      throw new WorkspaceBoundaryError(`Path is outside the writable workspace: ${absPath}`);
    }
    await this.assertRealWithin(absPath);
    if (!(await this.exists(absPath))) return false;
    await rm(absPath, { force: true });
    return true;
  }

  async exists(absPath: string): Promise<boolean> {
    await this.assertRealWithin(absPath);
    try {
      await stat(absPath);
      return true;
    } catch {
      return false;
    }
  }

  async stat(absPath: string): Promise<FileStamp | null> {
    await this.assertRealWithin(absPath);
    try {
      const s = await stat(absPath);
      return { mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      return null;
    }
  }

  async walk(opts: { respectGitignore?: boolean; limit?: number } = {}): Promise<string[]> {
    const limit = opts.limit ?? DEFAULT_WALK_LIMIT;
    const rules: IgnoreRule[] = opts.respectGitignore ? await this.loadRootGitignore() : [];
    const out: string[] = [];

    const walkDir = async (dir: string): Promise<void> => {
      if (out.length >= limit) return;
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
      if (!entries) return;
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (out.length >= limit) return;
        if (ALWAYS_IGNORE.has(entry.name)) continue;
        const abs = join(dir, entry.name);
        const rel = relative(this.root, abs).split(sep).join("/");
        const isDir = entry.isDirectory();
        if (rules.length && isIgnored(rel, isDir, rules)) continue;
        if (isDir) {
          await walkDir(abs);
        } else if (entry.isFile()) {
          out.push(abs);
        }
      }
    };

    await walkDir(this.root);
    return out;
  }

  private async loadRootGitignore(): Promise<IgnoreRule[]> {
    try {
      const content = await readFile(join(this.root, ".gitignore"), "utf8");
      return compileIgnore(content.split("\n"));
    } catch {
      return [];
    }
  }
}
