import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HookBus, PermissionBroker, PermissionEngine, ToolExecutor, ToolRegistry } from "../src/index";
import type { Tool } from "../src/index";
import { makeCtx } from "./fakes";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "zc-spill-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function bigTool(name: string, output: string, maxResultSizeChars?: number): Tool {
  return { name, description: "d", inputSchema: { type: "object" }, readOnly: true, maxResultSizeChars, async execute() { return { content: output }; } };
}

function executorWith(tool: Tool): ToolExecutor {
  const registry = new ToolRegistry().registerAll([tool]);
  const hooks = new HookBus();
  const engine = new PermissionEngine({ mode: "bypassPermissions", hookBus: hooks, broker: new PermissionBroker(), idGen: () => "p" });
  return new ToolExecutor(registry, engine, hooks, { now: () => 0 });
}

describe("per-tool result cap + disk spill", () => {
  it("spills oversized output to disk with a preview, preserving head AND tail", async () => {
    const spillDir = tmp();
    const output = `HEAD_MARKER${"x".repeat(50_000)}TAIL_MARKER`;
    const tool = bigTool("Bash", output, 1000);
    const { ctx } = makeCtx({ spillDir });
    const [rec] = await executorWith(tool).executeTurn([{ id: "c1", name: "Bash", input: {} }], ctx);

    expect(rec!.content).toContain("HEAD_MARKER"); // head kept
    expect(rec!.content).toContain("TAIL_MARKER"); // tail kept (the failure signal)
    expect(rec!.content).toMatch(/saved to .*c1\.txt/);
    expect(rec!.content.length).toBeLessThan(output.length);
    // The full output is on disk.
    expect(readFileSync(join(spillDir, "c1.txt"), "utf8")).toBe(output);
  });

  it("leaves a small output untouched", async () => {
    const tool = bigTool("Read", "small output", 1000);
    const { ctx } = makeCtx({ spillDir: tmp() });
    const [rec] = await executorWith(tool).executeTurn([{ id: "c2", name: "Read", input: {} }], ctx);
    expect(rec!.content).toBe("small output");
  });

  it("truncates (no path) when no spillDir is configured", async () => {
    const tool = bigTool("Read", "y".repeat(5000), 1000);
    const { ctx } = makeCtx(); // no spillDir
    const [rec] = await executorWith(tool).executeTurn([{ id: "c3", name: "Read", input: {} }], ctx);
    expect(rec!.content).toMatch(/truncated/);
    expect(rec!.content).not.toMatch(/saved to/);
  });
});
