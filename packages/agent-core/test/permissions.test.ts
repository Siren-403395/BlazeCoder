import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@coding-agent/shared";
import { HookBus, PermissionBroker, PermissionEngine } from "../src/index";
import type { BrokerDecision, EventSink, PermissionMode, PermissionRule, Tool } from "../src/index";

function tool(name: string, readOnly: boolean): Tool {
  return { name, readOnly, description: "d", inputSchema: { type: "object" }, execute: async () => ({ content: "" }) };
}

function makeEngine(
  opts: { mode?: PermissionMode; deny?: string[]; allow?: string[]; ask?: string[]; rules?: PermissionRule[]; hooks?: HookBus } = {},
) {
  const broker = new PermissionBroker();
  const hooks = opts.hooks ?? new HookBus();
  const engine = new PermissionEngine({
    mode: opts.mode ?? "default",
    deny: opts.deny,
    allow: opts.allow,
    ask: opts.ask,
    rules: opts.rules,
    hookBus: hooks,
    broker,
    idGen: () => "req1",
  });
  return { engine, broker };
}

const signal = new AbortController().signal;

/** An emit sink that auto-answers any permission_request with the given decision. */
function answer(decision: BrokerDecision, broker: PermissionBroker): EventSink {
  return (e: AgentEvent) => {
    if (e.type === "permission_request") broker.resolve(e.requestId, decision);
  };
}

describe("PermissionEngine", () => {
  it("default mode allows read-only and asks for mutating", async () => {
    const { engine, broker } = makeEngine({ mode: "default" });
    const ro = await engine.check(tool("read_file", true), {}, { emit: () => {}, signal });
    expect(ro.behavior).toBe("allow");

    const allowed = await engine.check(tool("write_file", false), { path: "/a" }, {
      emit: answer({ behavior: "allow" }, broker),
      signal,
    });
    expect(allowed.behavior).toBe("allow");

    const denied = await engine.check(tool("write_file", false), { path: "/a" }, {
      emit: answer({ behavior: "deny", message: "no" }, broker),
      signal,
    });
    expect(denied.behavior).toBe("deny");
  });

  it("acceptEdits allows edit tools but asks for Bash", async () => {
    const { engine, broker } = makeEngine({ mode: "acceptEdits" });
    const edit = await engine.check(tool("Write", false), { file_path: "/a" }, { emit: () => {}, signal });
    expect(edit.behavior).toBe("allow");

    let asked = false;
    const run = await engine.check(tool("Bash", false), {}, {
      emit: (e) => {
        if (e.type === "permission_request") {
          asked = true;
          broker.resolve(e.requestId, { behavior: "deny" });
        }
      },
      signal,
    });
    expect(asked).toBe(true);
    expect(run.behavior).toBe("deny");
  });

  it("plan mode denies mutating tools and allows read-only", async () => {
    const { engine } = makeEngine({ mode: "plan" });
    expect((await engine.check(tool("write_file", false), {}, { emit: () => {}, signal })).behavior).toBe("deny");
    expect((await engine.check(tool("read_file", true), {}, { emit: () => {}, signal })).behavior).toBe("allow");
  });

  it("bypass mode allows everything", async () => {
    const { engine } = makeEngine({ mode: "bypassPermissions" });
    expect((await engine.check(tool("write_file", false), { path: "/a" }, { emit: () => {}, signal })).behavior).toBe("allow");
  });

  it("deny rule beats mode", async () => {
    const { engine } = makeEngine({ mode: "bypassPermissions", deny: ["read_file"] });
    expect((await engine.check(tool("read_file", true), {}, { emit: () => {}, signal })).behavior).toBe("deny");
  });

  it("protects sensitive paths even in acceptEdits", async () => {
    const { engine } = makeEngine({ mode: "acceptEdits" });
    const res = await engine.check(tool("write_file", false), { path: "/.git/config" }, { emit: () => {}, signal });
    expect(res.behavior).toBe("deny");
  });

  it("a PreToolUse hook can deny", async () => {
    const hooks = new HookBus().onPreToolUse(({ input }) =>
      input.path === "/blocked" ? { decision: "deny", message: "blocked" } : { decision: "continue" },
    );
    const { engine } = makeEngine({ mode: "bypassPermissions", hooks });
    const res = await engine.check(tool("write_file", false), { path: "/blocked" }, { emit: () => {}, signal });
    expect(res.behavior).toBe("deny");
    expect(res.behavior === "deny" && res.message).toBe("blocked");
    expect(res.decisionReason.type).toBe("hook");
  });
});

describe("PermissionEngine — layered rules (behavior priority)", () => {
  it("a deny rule in 'user' beats an allow rule in 'local'", async () => {
    const rules: PermissionRule[] = [
      { source: "local", behavior: "allow", value: { toolName: "Bash", ruleContent: "git push:*" } },
      { source: "user", behavior: "deny", value: { toolName: "Bash", ruleContent: "git push:*" } },
    ];
    const { engine } = makeEngine({ mode: "bypassPermissions", rules });
    const res = await engine.check(tool("Bash", false), { command: "git push origin main" }, { emit: () => {}, signal });
    expect(res.behavior).toBe("deny");
    expect(res.decisionReason.type).toBe("rule");
    expect(res.decisionReason.type === "rule" && res.decisionReason.rule.source).toBe("user");
  });

  it("an allow rule lets a specific command through while an ask rule prompts for another", async () => {
    const { engine, broker } = makeEngine({
      mode: "default",
      allow: ["Bash(git status:*)"],
      ask: ["Bash(git push:*)"],
    });
    const allowed = await engine.check(tool("Bash", false), { command: "git status" }, { emit: () => {}, signal });
    expect(allowed.behavior).toBe("allow");
    expect(allowed.decisionReason.type).toBe("rule");

    let asked = false;
    const pushed = await engine.check(tool("Bash", false), { command: "git push origin main" }, {
      emit: (e) => {
        if (e.type === "permission_request") {
          asked = true;
          broker.resolve(e.requestId, { behavior: "deny" });
        }
      },
      signal,
    });
    expect(asked).toBe(true);
    expect(pushed.behavior).toBe("deny");
  });

  it("an allow rule auto-approves without prompting (decisionReason=rule)", async () => {
    const { engine } = makeEngine({ mode: "default", allow: ["Bash(npm test:*)"] });
    const res = await engine.check(tool("Bash", false), { command: "npm test" }, { emit: () => {}, signal });
    expect(res.behavior).toBe("allow");
    expect(res.decisionReason).toEqual({ type: "rule", rule: { source: "cliArg", behavior: "allow", value: { toolName: "Bash", ruleContent: "npm test:*" } } });
  });
});
