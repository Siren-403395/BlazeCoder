import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@coding-agent/shared";
import {
  buildPreviewTool,
  deleteFileTool,
  editFileTool,
  globTool,
  grepTool,
  listFilesTool,
  readFileTool,
  writeFileTool,
} from "../src/index";
import { FakePreviewBuilder, fullProject, makeCtx } from "./fakes";

describe("filesystem tools", () => {
  it("write_file creates a file and emits file_change", async () => {
    const { ctx, events } = makeCtx();
    const res = await writeFileTool.execute({ path: "/src/App.tsx", content: "export default 1" }, ctx);
    expect(res.isError).toBeFalsy();
    expect(ctx.workspace.read("/src/App.tsx")?.content).toBe("export default 1");
    const change = events.find((e): e is Extract<AgentEvent, { type: "file_change" }> => e.type === "file_change");
    expect(change?.op).toBe("write");
    expect(change?.path).toBe("/src/App.tsx");
  });

  it("read_file returns numbered lines and errors on missing", async () => {
    const { ctx } = makeCtx();
    ctx.workspace.write({ path: "/a.ts", language: "ts", content: "one\ntwo" });
    const res = await readFileTool.execute({ path: "/a.ts" }, ctx);
    expect(res.content).toContain("1\tone");
    expect(res.content).toContain("2\ttwo");
    const missing = await readFileTool.execute({ path: "/nope" }, ctx);
    expect(missing.isError).toBe(true);
  });

  it("read_file respects a line range", async () => {
    const { ctx } = makeCtx();
    ctx.workspace.write({ path: "/a.ts", language: "ts", content: "l1\nl2\nl3\nl4" });
    const res = await readFileTool.execute({ path: "/a.ts", start_line: 2, end_line: 3 }, ctx);
    expect(res.content).toContain("2\tl2");
    expect(res.content).toContain("3\tl3");
    expect(res.content).not.toContain("l1");
    expect(res.content).not.toContain("l4");
  });

  it("edit_file replaces a unique string, errors on missing/ambiguous", async () => {
    const { ctx } = makeCtx();
    ctx.workspace.write({ path: "/a.ts", language: "ts", content: "let x = 1; let y = 1;" });
    const ambiguous = await editFileTool.execute({ path: "/a.ts", old_string: "= 1", new_string: "= 2" }, ctx);
    expect(ambiguous.isError).toBe(true);

    const ok = await editFileTool.execute({ path: "/a.ts", old_string: "x = 1", new_string: "x = 9" }, ctx);
    expect(ok.isError).toBeFalsy();
    expect(ctx.workspace.read("/a.ts")?.content).toBe("let x = 9; let y = 1;");

    const replaceAll = await editFileTool.execute({ path: "/a.ts", old_string: "= ", new_string: "=", replace_all: true }, ctx);
    expect(replaceAll.isError).toBeFalsy();

    const notFound = await editFileTool.execute({ path: "/a.ts", old_string: "zzz", new_string: "q" }, ctx);
    expect(notFound.isError).toBe(true);
  });

  it("delete_file removes and emits", async () => {
    const { ctx, events } = makeCtx();
    ctx.workspace.write({ path: "/a.ts", language: "ts", content: "x" });
    const res = await deleteFileTool.execute({ path: "/a.ts" }, ctx);
    expect(res.isError).toBeFalsy();
    expect(ctx.workspace.exists("/a.ts")).toBe(false);
    expect(events.some((e) => e.type === "file_change" && e.op === "delete")).toBe(true);
  });

  it("list_files reports files and empty state", async () => {
    const { ctx } = makeCtx();
    expect((await listFilesTool.execute({}, ctx)).content).toMatch(/empty/i);
    ctx.workspace.write({ path: "/a.ts", language: "ts", content: "x" });
    expect((await listFilesTool.execute({}, ctx)).content).toContain("/a.ts");
  });
});

describe("search tools", () => {
  it("grep finds matching lines with path:line", async () => {
    const { ctx } = makeCtx();
    ctx.workspace.write({ path: "/a.ts", language: "ts", content: "const foo = 1;\nconst bar = 2;" });
    const res = await grepTool.execute({ pattern: "foo" }, ctx);
    expect(res.content).toContain("/a.ts:1");
    const none = await grepTool.execute({ pattern: "zzz" }, ctx);
    expect(none.content).toMatch(/no matches/i);
  });

  it("glob matches paths with ** and *", async () => {
    const { ctx } = makeCtx();
    ctx.workspace.write({ path: "/src/a.tsx", language: "tsx", content: "x" });
    ctx.workspace.write({ path: "/src/deep/b.tsx", language: "tsx", content: "x" });
    ctx.workspace.write({ path: "/src/c.ts", language: "ts", content: "x" });
    const res = await globTool.execute({ pattern: "/src/**/*.tsx" }, ctx);
    expect(res.content).toContain("/src/a.tsx");
    expect(res.content).toContain("/src/deep/b.tsx");
    expect(res.content).not.toContain("/src/c.ts");
  });
});

describe("build_preview tool", () => {
  it("builds when the project is valid and emits a preview event", async () => {
    const builder = new FakePreviewBuilder();
    const { ctx, events } = makeCtx({ previewBuilder: builder, workspace: undefined });
    for (const f of fullProject().files) ctx.workspace.write(f);
    const res = await buildPreviewTool.execute({}, ctx);
    expect(res.isError).toBeFalsy();
    expect(builder.builds).toBe(1);
    expect(events.some((e) => e.type === "preview" && e.ok === true)).toBe(true);
  });

  it("blocks and reports when required files are missing", async () => {
    const { ctx, events } = makeCtx();
    ctx.workspace.write({ path: "/src/App.tsx", language: "tsx", content: "export default () => null" });
    const res = await buildPreviewTool.execute({}, ctx);
    expect(res.isError).toBe(true);
    expect(events.some((e) => e.type === "preview" && e.ok === false)).toBe(true);
  });
});
