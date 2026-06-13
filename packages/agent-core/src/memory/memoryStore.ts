/**
 * MemoryStore implementations — sandboxed to "/memories". Every path is checked
 * for traversal (reusing the shared validation primitive) and, for the FS-backed
 * store, canonically resolved and asserted to stay inside the root.
 *
 * - InMemoryMemoryStore: for tests and ephemeral runs.
 * - FileMemoryStore: durable, per-project cross-session memory.
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { isUnsafeRelativePath } from "@coding-agent/shared";
import type { MemoryStore } from "../ports";

const ROOT = "/memories";

function assertMemoryPath(path: string): string {
  if (!path.startsWith(ROOT)) {
    throw new Error(`Memory paths must start with "${ROOT}" (got "${path}").`);
  }
  if (isUnsafeRelativePath(path)) {
    throw new Error(`Unsafe memory path rejected: ${path}`);
  }
  return path.replace(/\/+/g, "/");
}

function numbered(content: string): string {
  return content
    .split("\n")
    .map((line, i) => `${String(i + 1).padStart(6)}\t${line}`)
    .join("\n");
}

export class InMemoryMemoryStore implements MemoryStore {
  private readonly files = new Map<string, string>();

  async view(path: string): Promise<string> {
    const p = assertMemoryPath(path);
    if (this.files.has(p)) return numbered(this.files.get(p)!);
    const children = [...this.files.keys()].filter((k) => k.startsWith(p === ROOT ? ROOT : `${p}/`));
    if (children.length || p === ROOT) {
      return children.length ? `Directory ${p}:\n${children.sort().join("\n")}` : `Directory ${p} is empty.`;
    }
    throw new Error(`No such memory file or directory: ${p}`);
  }

  async create(path: string, content: string): Promise<void> {
    this.files.set(assertMemoryPath(path), content);
  }

  async strReplace(path: string, oldStr: string, newStr: string): Promise<void> {
    const p = assertMemoryPath(path);
    const current = this.files.get(p);
    if (current === undefined) throw new Error(`No such memory file: ${p}`);
    if (!current.includes(oldStr)) throw new Error(`Text to replace not found in ${p}.`);
    this.files.set(p, current.replace(oldStr, newStr));
  }

  async insert(path: string, line: number, content: string): Promise<void> {
    const p = assertMemoryPath(path);
    const lines = (this.files.get(p) ?? "").split("\n");
    const at = Math.max(0, Math.min(lines.length, line - 1));
    lines.splice(at, 0, content);
    this.files.set(p, lines.join("\n"));
  }

  async remove(path: string): Promise<void> {
    this.files.delete(assertMemoryPath(path));
  }

  async rename(from: string, to: string): Promise<void> {
    const a = assertMemoryPath(from);
    const b = assertMemoryPath(to);
    const current = this.files.get(a);
    if (current === undefined) throw new Error(`No such memory file: ${a}`);
    this.files.delete(a);
    this.files.set(b, current);
  }
}

export class FileMemoryStore implements MemoryStore {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  private toFs(path: string): string {
    const p = assertMemoryPath(path);
    const rel = p.slice(ROOT.length).replace(/^\/+/, "");
    const full = resolve(join(this.root, rel));
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error(`Memory path escapes the sandbox: ${path}`);
    }
    return full;
  }

  async view(path: string): Promise<string> {
    const full = this.toFs(path);
    try {
      const content = await readFile(full, "utf8");
      return numbered(content);
    } catch {
      return `No such memory file (or it is a directory): ${path}`;
    }
  }

  async create(path: string, content: string): Promise<void> {
    const full = this.toFs(path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }

  async strReplace(path: string, oldStr: string, newStr: string): Promise<void> {
    const full = this.toFs(path);
    const current = await readFile(full, "utf8");
    if (!current.includes(oldStr)) throw new Error(`Text to replace not found in ${path}.`);
    await writeFile(full, current.replace(oldStr, newStr), "utf8");
  }

  async insert(path: string, line: number, content: string): Promise<void> {
    const full = this.toFs(path);
    let current = "";
    try {
      current = await readFile(full, "utf8");
    } catch {
      await mkdir(dirname(full), { recursive: true });
    }
    const lines = current.split("\n");
    const at = Math.max(0, Math.min(lines.length, line - 1));
    lines.splice(at, 0, content);
    await writeFile(full, lines.join("\n"), "utf8");
  }

  async remove(path: string): Promise<void> {
    await rm(this.toFs(path), { force: true });
  }

  async rename(from: string, to: string): Promise<void> {
    const a = this.toFs(from);
    const b = this.toFs(to);
    await mkdir(dirname(b), { recursive: true });
    await rename(a, b);
  }
}
