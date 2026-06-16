/**
 * Workspace boundary — the lexical half of "the agent may only touch files
 * inside its working roots". resolveWithin canonicalizes an agent-supplied path
 * (absolute, or relative to the primary root) and asserts it stays inside one of
 * the allowed roots; the FileSystemWorkspace adds a realpath/symlink check on top
 * at IO time so a symlink cannot smuggle a write outside the boundary.
 */

import { isAbsolute, resolve, sep } from "node:path";

export class WorkspaceBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceBoundaryError";
  }
}

/**
 * The slice of node:path the boundary needs. Defaults to the PLATFORM rules (correct for the
 * real FileSystemWorkspace on disk); InMemoryWorkspace passes node:path's `posix` so its virtual
 * "/" root resolves identically on every OS — on Windows the platform rules rewrite a leading
 * "/" to a drive letter (C:\…), which makes the virtual paths escape the "/" root.
 */
export interface PathApi {
  isAbsolute(p: string): boolean;
  resolve(...segments: string[]): string;
  sep: string;
}

const PLATFORM: PathApi = { isAbsolute, resolve, sep };

/** True if the canonical absolute path `abs` is the root or lives beneath it. */
export function isWithin(root: string, abs: string, p: PathApi = PLATFORM): boolean {
  if (abs === root) return true;
  const prefix = root.endsWith(p.sep) ? root : root + p.sep;
  return abs.startsWith(prefix);
}

/**
 * Resolve `inputPath` to a canonical absolute path that must lie within one of
 * `roots`. Relative inputs resolve against `base` (the primary root). Throws
 * WorkspaceBoundaryError if the result escapes every root. `p` selects the path
 * flavor (platform by default; posix for the virtual InMemoryWorkspace).
 */
export function resolveWithin(roots: readonly string[], base: string, inputPath: string, p: PathApi = PLATFORM): string {
  if (!inputPath) throw new WorkspaceBoundaryError("Empty path.");
  if (inputPath.includes("\0")) throw new WorkspaceBoundaryError(`Path contains a NUL byte: ${inputPath}`);
  const abs = p.isAbsolute(inputPath) ? p.resolve(inputPath) : p.resolve(base, inputPath);
  if (roots.some((root) => isWithin(root, abs, p))) return abs;
  throw new WorkspaceBoundaryError(
    `Path escapes the workspace boundary: ${inputPath} (allowed roots: ${roots.join(", ")})`,
  );
}
