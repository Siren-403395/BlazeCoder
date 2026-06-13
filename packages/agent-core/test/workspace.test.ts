import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSystemWorkspace, InMemoryWorkspace, WorkspaceBoundaryError } from "../src/index";

describe("InMemoryWorkspace", () => {
  it("writes, reads, exists, deletes and walks", async () => {
    const ws = new InMemoryWorkspace();
    expect(await ws.walk()).toHaveLength(0);

    await ws.write({ path: "/src/App.tsx", language: "tsx", content: "a" });
    await ws.write({ path: "/src/b.ts", language: "ts", content: "b" });
    expect(await ws.walk()).toEqual(["/src/App.tsx", "/src/b.ts"]);
    expect((await ws.read("/src/App.tsx"))?.content).toBe("a");
    expect(await ws.exists("/src/b.ts")).toBe(true);

    expect(await ws.delete("/src/b.ts")).toBe(true);
    expect(await ws.delete("/missing")).toBe(false);
    expect(await ws.walk()).toEqual(["/src/App.tsx"]);
  });

  it("resolves relative and absolute paths into the virtual root", () => {
    const ws = new InMemoryWorkspace();
    expect(ws.resolve("/src/App.tsx")).toBe("/src/App.tsx");
    expect(ws.resolve("src/App.tsx")).toBe("/src/App.tsx");
  });

  it("bumps mtime on write so the ledger can detect staleness", async () => {
    const ws = new InMemoryWorkspace();
    await ws.write({ path: "/a.ts", language: "ts", content: "x" });
    const first = await ws.stat("/a.ts");
    await ws.write({ path: "/a.ts", language: "ts", content: "xy" });
    const second = await ws.stat("/a.ts");
    expect(second!.mtimeMs).toBeGreaterThan(first!.mtimeMs);
    expect(second!.size).toBe(2);
  });

  it("returns copies (no external mutation of internal state)", async () => {
    const ws = new InMemoryWorkspace();
    await ws.write({ path: "/a.ts", language: "ts", content: "x" });
    const read = (await ws.read("/a.ts"))!;
    read.content = "mutated";
    expect((await ws.read("/a.ts"))?.content).toBe("x");
  });
});

describe("FileSystemWorkspace", () => {
  let root: string;
  let ws: FileSystemWorkspace;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ca-ws-"));
    ws = new FileSystemWorkspace({ root });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes (creating dirs), reads, stats, and deletes real files", async () => {
    const abs = ws.resolve("src/app.ts");
    await ws.write({ path: abs, language: "ts", content: "export const x = 1;\n" });
    expect((await ws.read(abs))?.content).toBe("export const x = 1;\n");
    expect(await ws.exists(abs)).toBe(true);
    expect((await ws.stat(abs))?.size).toBeGreaterThan(0);
    expect(await ws.delete(abs)).toBe(true);
    expect(await ws.exists(abs)).toBe(false);
  });

  it("rejects paths outside the boundary", () => {
    expect(() => ws.resolve("../escape.ts")).toThrow(WorkspaceBoundaryError);
    expect(ws.isWritable(ws.resolve("ok.ts"))).toBe(true);
  });

  it("walk skips node_modules and .git, and can honor .gitignore", async () => {
    await ws.write({ path: ws.resolve("keep.ts"), language: "ts", content: "1" });
    await ws.write({ path: ws.resolve("ignored.log"), language: "txt", content: "1" });
    await mkdir(join(root, "node_modules", "dep"), { recursive: true });
    await writeFile(join(root, "node_modules", "dep", "index.js"), "1");
    await writeFile(join(root, ".gitignore"), "*.log\n");

    const all = await ws.walk();
    expect(all.some((p) => p.endsWith("keep.ts"))).toBe(true);
    expect(all.some((p) => p.includes("node_modules"))).toBe(false);
    expect(all.some((p) => p.endsWith("ignored.log"))).toBe(true); // gitignore off by default

    const respected = await ws.walk({ respectGitignore: true });
    expect(respected.some((p) => p.endsWith("ignored.log"))).toBe(false);
    expect(respected.some((p) => p.endsWith("keep.ts"))).toBe(true);
  });

  it("refuses to read, write, or delete through a symlink that escapes the boundary", async () => {
    const outside = await mkdtemp(join(tmpdir(), "ca-out-"));
    await writeFile(join(outside, "secret.txt"), "top secret");
    const link = join(root, "link.txt");
    await symlink(join(outside, "secret.txt"), link);
    await expect(ws.read(link)).rejects.toBeInstanceOf(WorkspaceBoundaryError);
    await expect(ws.write({ path: link, language: "txt", content: "x" })).rejects.toBeInstanceOf(WorkspaceBoundaryError);
    await expect(ws.delete(link)).rejects.toBeInstanceOf(WorkspaceBoundaryError);
    await expect(ws.stat(link)).rejects.toBeInstanceOf(WorkspaceBoundaryError);
    await rm(outside, { recursive: true, force: true });
  });
});
