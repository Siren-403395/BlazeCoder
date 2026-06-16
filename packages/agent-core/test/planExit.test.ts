import { describe, expect, it } from "vitest";
import { HookBus, PermissionBroker, PermissionEngine, TOOL_NAMES } from "../src/index";
import type { Tool } from "../src/index";

const exitTool = { name: TOOL_NAMES.exitPlanMode, readOnly: false, description: "", inputSchema: { type: "object" }, execute: async () => ({ content: "" }) } as Tool;
const bashTool = { name: TOOL_NAMES.bash, readOnly: false, description: "", inputSchema: { type: "object" }, execute: async () => ({ content: "" }) } as Tool;

function mkEngine(mode: "plan" | "acceptEdits") {
  const broker = new PermissionBroker();
  const engine = new PermissionEngine({ mode, hookBus: new HookBus(), broker, idGen: () => "r" });
  return { engine, broker };
}
const run = () => ({ emit: () => {}, signal: new AbortController().signal });
const flush = () => new Promise((r) => setTimeout(r, 10));

describe("ExitPlanMode flow", () => {
  it("is denied outside plan mode", async () => {
    const { engine } = mkEngine("acceptEdits");
    const d = await engine.check(exitTool, { plan: "do x" }, run());
    expect(d.behavior).toBe("deny");
  });

  it("in plan mode: asks, then flips to acceptEdits and pre-approves allowedCommands on approval", async () => {
    const { engine, broker } = mkEngine("plan");
    const events: { type: string }[] = [];
    const p = engine.check(
      exitTool,
      { plan: "1. edit foo\n2. run tests", allowedCommands: ["npm test"] },
      { emit: (e) => events.push(e), signal: new AbortController().signal },
    );
    await flush();
    expect(events.some((e) => e.type === "permission_request")).toBe(true);
    expect(broker.resolve("r", { behavior: "allow" })).toBe(true);

    const d = await p;
    expect(d.behavior).toBe("allow");
    expect(engine.getMode()).toBe("acceptEdits");

    // The pre-approved command now runs without a prompt (session allow-rule).
    const bash = await engine.check(bashTool, { command: "npm test" }, run());
    expect(bash.behavior).toBe("allow");
  });

  it("stays in plan mode when the user rejects the plan", async () => {
    const { engine, broker } = mkEngine("plan");
    const p = engine.check(exitTool, { plan: "do x" }, run());
    await flush();
    broker.resolve("r", { behavior: "deny" });
    const d = await p;
    expect(d.behavior).toBe("deny");
    expect(engine.getMode()).toBe("plan");
  });
});
