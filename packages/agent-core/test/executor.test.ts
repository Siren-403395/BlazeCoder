import { describe, expect, it } from "vitest";
import {
  FixedClock,
  HookBus,
  PermissionBroker,
  PermissionEngine,
  ToolExecutor,
  ToolRegistry,
} from "../src/index";
import type { PermissionMode, Tool } from "../src/index";
import { call, makeCtx } from "./fakes";

function makeTool(
  name: string,
  execute: Tool["execute"],
  readOnly = false,
): Tool {
  return { name, readOnly, description: "test tool", inputSchema: { type: "object" }, execute };
}

function setup(opts: {
  tools: Tool[];
  mode?: PermissionMode;
  deny?: string[];
  hooks?: HookBus;
  defaultTimeoutMs?: number;
}) {
  const hooks = opts.hooks ?? new HookBus();
  const engine = new PermissionEngine({
    mode: opts.mode ?? "bypassPermissions",
    deny: opts.deny,
    hookBus: hooks,
    broker: new PermissionBroker(),
    idGen: () => "r",
  });
  const registry = new ToolRegistry().registerAll(opts.tools);
  const executor = new ToolExecutor(registry, engine, hooks, new FixedClock(), {
    defaultTimeoutMs: opts.defaultTimeoutMs,
  });
  return { executor };
}

describe("ToolExecutor", () => {
  it("runs tools and preserves call order in results", async () => {
    const a = makeTool("a", async () => ({ content: "A" }), true);
    const b = makeTool("b", async () => ({ content: "B" }), false);
    const { executor } = setup({ tools: [a, b] });
    const { ctx } = makeCtx();
    const results = await executor.executeTurn([call("1", "a"), call("2", "b")], ctx);
    expect(results.map((r) => r.content)).toEqual(["A", "B"]);
    expect(results.map((r) => r.toolUseId)).toEqual(["1", "2"]);
  });

  it("returns isError for an unknown tool (does not throw)", async () => {
    const { executor } = setup({ tools: [makeTool("a", async () => ({ content: "A" }))] });
    const { ctx } = makeCtx();
    const [res] = await executor.executeTurn([call("1", "nope")], ctx);
    expect(res!.isError).toBe(true);
    expect(res!.content).toMatch(/unknown tool/i);
  });

  it("converts a thrown error into an isError result (loop survives)", async () => {
    const boom = makeTool("boom", async () => {
      throw new Error("kaboom");
    });
    const { executor } = setup({ tools: [boom] });
    const { ctx } = makeCtx();
    const [res] = await executor.executeTurn([call("1", "boom")], ctx);
    expect(res!.isError).toBe(true);
    expect(res!.content).toMatch(/kaboom/);
  });

  it("denies via a deny rule", async () => {
    const a = makeTool("a", async () => ({ content: "A" }), true);
    const { executor } = setup({ tools: [a], deny: ["a"], mode: "default" });
    const { ctx } = makeCtx();
    const [res] = await executor.executeTurn([call("1", "a")], ctx);
    expect(res!.isError).toBe(true);
    expect(res!.content).toMatch(/denied/i);
  });

  it("times out a slow tool", async () => {
    const slow = makeTool("slow", () => new Promise((resolve) => setTimeout(() => resolve({ content: "late" }), 80)));
    const { executor } = setup({ tools: [slow], defaultTimeoutMs: 5 });
    const { ctx } = makeCtx();
    const [res] = await executor.executeTurn([call("1", "slow")], ctx);
    expect(res!.isError).toBe(true);
    expect(res!.content).toMatch(/timed out/);
  });

  it("applies PostToolUse hook transforms", async () => {
    const hooks = new HookBus().onPostToolUse(({ result }) => ({ content: `${result.content}!` }));
    const a = makeTool("a", async () => ({ content: "A" }), true);
    const { executor } = setup({ tools: [a], hooks });
    const { ctx } = makeCtx();
    const [res] = await executor.executeTurn([call("1", "a")], ctx);
    expect(res!.content).toBe("A!");
  });

  it("emits a tool_result event per call", async () => {
    const a = makeTool("a", async () => ({ content: "A" }), true);
    const { executor } = setup({ tools: [a] });
    const { ctx, events } = makeCtx();
    await executor.executeTurn([call("1", "a")], ctx);
    expect(events.some((e) => e.type === "tool_result" && e.toolUseId === "1")).toBe(true);
  });
});
