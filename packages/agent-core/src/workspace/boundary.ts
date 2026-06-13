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

/** True if the canonical absolute path `abs` is the root or lives beneath it. */
export function isWithin(root: string, abs: string): boolean {
  if (abs === root) return true;
  const prefix = root.endsWith(sep) ? root : root + sep;
  return abs.startsWith(prefix);
}

/**
 * Resolve `inputPath` to a canonical absolute path that must lie within one of
 * `roots`. Relative inputs resolve against `base` (the primary root). Throws
 * WorkspaceBoundaryError if the result escapes every root.
 */
export function resolveWithin(roots: readonly string[], base: string, inputPath: string): string {
  if (!inputPath) throw new WorkspaceBoundaryError("Empty path.");
  if (inputPath.includes("\0")) throw new WorkspaceBoundaryError(`Path contains a NUL byte: ${inputPath}`);
  const abs = isAbsolute(inputPath) ? resolve(inputPath) : resolve(base, inputPath);
  if (roots.some((root) => isWithin(root, abs))) return abs;
  throw new WorkspaceBoundaryError(
    `Path escapes the workspace boundary: ${inputPath} (allowed roots: ${roots.join(", ")})`,
  );
}
