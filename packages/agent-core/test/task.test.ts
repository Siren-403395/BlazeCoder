import { describe, expect, it } from "vitest";
import { AgentRegistry, builtinTools, makeTaskTool, ToolRegistry } from "../src/index";
import type { SubagentRunResult } from "../src/index";
import { makeCtx } from "./fakes";

const registry = new AgentRegistry();
const task = makeTaskTool(registry);
const fullRegistry = () => new ToolRegistry().registerAll([...builtinTools(), makeTaskTool(registry)]);

describe("ToolRegistry.filter (per-agent tool pool, no-nest)", () => {
  it("restricts to the allowed names and always drops Task", () => {
    const f = fullRegistry().filter(["Read"]);
    expect(f.names()).toEqual(["Read"]);
    expect(f.has("Write")).toBe(false);
  });

  it("never includes Task even when named (no nesting)", () => {
    expect(fullRegistry().filter(["Read", "Task"]).has("Task")).toBe(false);
  });

  it("the explorer pool is exactly Read/Grep/Glob", () => {
    expect(fullRegistry().filter(["Read", "Grep", "Glob"]).names().sort()).toEqual(["Glob", "Grep", "Read"]);
  });
});
const ok = (text: string): SubagentRunResult => ({ text, turns: 1, subtype: "success" });

describe("Task tool", () => {
  it("spawns the default (builder) agent and returns its report at depth 0", async () => {
    const { ctx } = makeCtx();
    let seen: { name: string; prompt: string } | undefined;
    ctx.spawn = async (def, prompt) => {
      seen = { name: def.name, prompt };
      return ok(`report: ${prompt}`);
    };
    const res = await task.execute({ description: "explore foo", prompt: "look at src/" }, ctx);
    expect(res.isError).toBeFalsy();
    expect(res.content).toBe("report: look at src/");
    expect(seen).toEqual({ name: "builder", prompt: "look at src/" });
  });

  it("routes subagent_type to the matching definition", async () => {
    const { ctx } = makeCtx();
    ctx.spawn = async (def) => ok(def.name);
    const res = await task.execute({ description: "x", subagent_type: "explorer", prompt: "p" }, ctx);
    expect(res.content).toBe("explorer");
  });

  it("errors on an unknown subagent_type", async () => {
    const { ctx } = makeCtx();
    ctx.spawn = async () => ok("x");
    const res = await task.execute({ description: "x", subagent_type: "nope", prompt: "p" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/Unknown subagent_type/);
  });

  it("refuses to nest (depth > 0)", async () => {
    const { ctx } = makeCtx();
    ctx.depth = 1;
    let spawned = false;
    ctx.spawn = async () => {
      spawned = true;
      return ok("x");
    };
    const res = await task.execute({ description: "x", prompt: "p" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/nest/i);
    expect(spawned).toBe(false); // never even attempted
  });

  it("errors when no spawner is available", async () => {
    const { ctx } = makeCtx(); // no ctx.spawn
    const res = await task.execute({ description: "x", prompt: "p" }, ctx);
    expect(res.isError).toBe(true);
  });

  it("requires a non-empty prompt", async () => {
    const { ctx } = makeCtx();
    ctx.spawn = async () => ok("x");
    expect((await task.execute({ description: "x", prompt: "   " }, ctx)).isError).toBe(true);
  });

  it("exposes the registered agent types in its schema enum", () => {
    const types = (task.inputSchema as { properties: { subagent_type: { enum: string[] } } }).properties.subagent_type.enum;
    expect(types).toContain("builder");
    expect(types).toContain("explorer");
  });
});
