import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileMemoryStore, InMemoryMemoryStore, memoryTool } from "../src/index";
import { makeCtx } from "./fakes";

describe("InMemoryMemoryStore", () => {
  it("supports the full command vocabulary", async () => {
    const m = new InMemoryMemoryStore();
    await m.create("/memories/notes.md", "hello\nworld");
    expect(await m.view("/memories/notes.md")).toContain("1\thello");

    await m.strReplace("/memories/notes.md", "hello", "hi");
    expect(await m.view("/memories/notes.md")).toContain("1\thi");

    await m.insert("/memories/notes.md", 1, "TOP");
    expect(await m.view("/memories/notes.md")).toContain("1\tTOP");

    await m.rename("/memories/notes.md", "/memories/renamed.md");
    expect(await m.view("/memories/renamed.md")).toContain("TOP");

    await m.remove("/memories/renamed.md");
    await expect(m.view("/memories/renamed.md")).rejects.toThrow();
  });

  it("rejects traversal and out-of-sandbox paths", async () => {
    const m = new InMemoryMemoryStore();
    await expect(m.create("/memories/../escape", "x")).rejects.toThrow();
    await expect(m.create("/etc/passwd", "x")).rejects.toThrow();
  });
});

describe("FileMemoryStore", () => {
  it("persists under the sandbox root and blocks escapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "mem-"));
    const m = new FileMemoryStore(root);
    await m.create("/memories/a.txt", "data");
    expect(await m.view("/memories/a.txt")).toContain("1\tdata");
    await expect(m.create("/memories/../../etc/x", "x")).rejects.toThrow();
  });
});

describe("memory tool", () => {
  it("dispatches commands through the store", async () => {
    const { ctx } = makeCtx();
    expect((await memoryTool.execute({ command: "view" }, ctx)).content).toMatch(/empty|Directory/);
    const created = await memoryTool.execute({ command: "create", path: "/memories/x.md", file_text: "hi" }, ctx);
    expect(created.isError).toBeFalsy();
    expect((await memoryTool.execute({ command: "view", path: "/memories/x.md" }, ctx)).content).toContain("hi");
  });

  it("returns isError instead of throwing on a bad path", async () => {
    const { ctx } = makeCtx();
    const res = await memoryTool.execute({ command: "create", path: "/nope/x", file_text: "y" }, ctx);
    expect(res.isError).toBe(true);
  });
});
