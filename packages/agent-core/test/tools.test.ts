import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@zephyrcode/shared";
import { editFileTool, globTool, grepTool, readFileTool, writeFileTool } from "../src/index";
import { makeCtx } from "./fakes";

describe("Write tool", () => {
  it("creates a file, emits file_change, and records the read-ledger", async () => {
    const { ctx, events } = makeCtx();
    const res = await writeFileTool.execute({ file_path: "/src/App.tsx", content: "export default 1\n" }, ctx);
    expect(res.isError).toBeFalsy();
    expect((await ctx.workspace.read("/src/App.tsx"))?.content).toBe("export default 1\n");
    const change = events.find((e): e is Extract<AgentEvent, { type: "file_change" }> => e.type === "file_change");
    expect(change?.op).toBe("write");
    expect(change?.path).toBe("/src/App.tsx");
    // A freshly written file is in the ledger, so a follow-up Edit is allowed.
    expect(ctx.ledger.has("/src/App.tsx")).toBe(true);
  });

  it("refuses to overwrite an existing file that was not read first", async () => {
    const { ctx } = makeCtx();
    await ctx.workspace.write({ path: "/a.ts", language: "ts", content: "old" });
    const res = await writeFileTool.execute({ file_path: "/a.ts", content: "new" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/read it before overwriting/i);
    expect((await ctx.workspace.read("/a.ts"))?.content).toBe("old");
  });

  it("refuses to write content that looks like a secret", async () => {
    const { ctx } = makeCtx();
    const res = await writeFileTool.execute(
      { file_path: "/cfg.ts", content: 'const k = "sk-abcdefghijklmnopqrstuvwxyz0123"' },
      ctx,
    );
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/secret/i);
  });
});

describe("Read tool", () => {
  it("returns numbered lines and errors on a missing file", async () => {
    const { ctx } = makeCtx();
    await ctx.workspace.write({ path: "/a.ts", language: "ts", content: "one\ntwo" });
    const res = await readFileTool.execute({ file_path: "/a.ts" }, ctx);
    expect(res.content).toContain("1\tone");
    expect(res.content).toContain("2\ttwo");
    expect(ctx.ledger.has("/a.ts")).toBe(true);
    const missing = await readFileTool.execute({ file_path: "/nope" }, ctx);
    expect(missing.isError).toBe(true);
  });

  it("respects offset and limit", async () => {
    const { ctx } = makeCtx();
    await ctx.workspace.write({ path: "/a.ts", language: "ts", content: "l1\nl2\nl3\nl4" });
    const res = await readFileTool.execute({ file_path: "/a.ts", offset: 2, limit: 2 }, ctx);
    expect(res.content).toContain("2\tl2");
    expect(res.content).toContain("3\tl3");
    expect(res.content).not.toContain("\tl1");
    expect(res.content).not.toContain("\tl4");
  });

  it("refuses to read a secret/credential file", async () => {
    const { ctx } = makeCtx();
    const res = await readFileTool.execute({ file_path: "/.env" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/secret/i);
  });
});

describe("Edit tool", () => {
  it("requires the file to be read first", async () => {
    const { ctx } = makeCtx();
    await ctx.workspace.write({ path: "/a.ts", language: "ts", content: "let x = 1;" });
    const res = await editFileTool.execute({ file_path: "/a.ts", old_string: "x = 1", new_string: "x = 2" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/read .* before editing/i);
  });

  it("replaces a unique string after the file is read; errors on missing/ambiguous", async () => {
    const { ctx } = makeCtx();
    await ctx.workspace.write({ path: "/a.ts", language: "ts", content: "let x = 1; let y = 1;" });
    await readFileTool.execute({ file_path: "/a.ts" }, ctx);

    const ambiguous = await editFileTool.execute({ file_path: "/a.ts", old_string: "= 1", new_string: "= 2" }, ctx);
    expect(ambiguous.isError).toBe(true);

    const ok = await editFileTool.execute({ file_path: "/a.ts", old_string: "x = 1", new_string: "x = 9" }, ctx);
    expect(ok.isError).toBeFalsy();
    expect((await ctx.workspace.read("/a.ts"))?.content).toBe("let x = 9; let y = 1;");

    const replaceAll = await editFileTool.execute({ file_path: "/a.ts", old_string: "= ", new_string: "=", replace_all: true }, ctx);
    expect(replaceAll.isError).toBeFalsy();

    const notFound = await editFileTool.execute({ file_path: "/a.ts", old_string: "zzz", new_string: "q" }, ctx);
    expect(notFound.isError).toBe(true);
  });

  it("rejects an empty old_string (would otherwise corrupt the file with replace_all)", async () => {
    const { ctx } = makeCtx();
    await ctx.workspace.write({ path: "/a.ts", language: "ts", content: "hello" });
    await readFileTool.execute({ file_path: "/a.ts" }, ctx);
    const res = await editFileTool.execute({ file_path: "/a.ts", old_string: "", new_string: "X", replace_all: true }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/cannot be empty/i);
    expect((await ctx.workspace.read("/a.ts"))?.content).toBe("hello");
  });

  it("detects a file that changed on disk since it was read", async () => {
    const { ctx } = makeCtx();
    await ctx.workspace.write({ path: "/a.ts", language: "ts", content: "v1" });
    await readFileTool.execute({ file_path: "/a.ts" }, ctx);
    // An external change (not via the tools) bumps mtime.
    await ctx.workspace.write({ path: "/a.ts", language: "ts", content: "v1-external" });
    const res = await editFileTool.execute({ file_path: "/a.ts", old_string: "v1", new_string: "v2" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/changed on disk/i);
  });
});

describe("Glob tool", () => {
  it("matches paths with ** and *", async () => {
    const { ctx } = makeCtx();
    await ctx.workspace.write({ path: "/src/a.tsx", language: "tsx", content: "x" });
    await ctx.workspace.write({ path: "/src/deep/b.tsx", language: "tsx", content: "x" });
    await ctx.workspace.write({ path: "/src/c.ts", language: "ts", content: "x" });
    const res = await globTool.execute({ pattern: "**/*.tsx" }, ctx);
    expect(res.content).toContain("/src/a.tsx");
    expect(res.content).toContain("/src/deep/b.tsx");
    expect(res.content).not.toContain("/src/c.ts");
  });

  it("never surfaces secret/credential file paths", async () => {
    const { ctx } = makeCtx();
    await ctx.workspace.write({ path: "/app.ts", language: "ts", content: "x" });
    await ctx.workspace.write({ path: "/.env", language: "txt", content: "TOKEN=1" });
    const res = await globTool.execute({ pattern: "**/*" }, ctx);
    expect(res.content).toContain("/app.ts");
    expect(res.content).not.toContain("/.env");
  });
});

describe("Grep tool", () => {
  it("lists matching files, shows content, and counts", async () => {
    const { ctx } = makeCtx();
    await ctx.workspace.write({ path: "/a.ts", language: "ts", content: "const foo = 1;\nconst bar = 2;" });
    await ctx.workspace.write({ path: "/b.ts", language: "ts", content: "const baz = 3;" });

    const files = await grepTool.execute({ pattern: "foo" }, ctx);
    expect(files.content).toContain("/a.ts");
    expect(files.content).not.toContain("/b.ts");

    const content = await grepTool.execute({ pattern: "const", output_mode: "content" }, ctx);
    expect(content.content).toContain("/a.ts:1:");

    const count = await grepTool.execute({ pattern: "const", output_mode: "count" }, ctx);
    expect(count.content).toContain("/a.ts: 2");

    const none = await grepTool.execute({ pattern: "zzz" }, ctx);
    expect(none.content).toMatch(/no matches/i);
  });

  it("never reads or surfaces secret file contents", async () => {
    const { ctx } = makeCtx();
    await ctx.workspace.write({ path: "/.env", language: "txt", content: "API_KEY=supersecret123" });
    const res = await grepTool.execute({ pattern: "API_KEY", output_mode: "content" }, ctx);
    expect(res.content).not.toContain("supersecret123");
    expect(res.content).not.toContain("/.env");
    expect(res.content).toMatch(/no matches/i);
  });
});
