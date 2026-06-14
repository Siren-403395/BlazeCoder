import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@zephyrcode/shared";
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

  it("denies (never hangs) at the ask gate when the run was already aborted", async () => {
    // Regression: the broker arms cancellation via signal.addEventListener("abort"), which does
    // NOT fire for an already-aborted signal. If a second mutating tool reaches the ask gate after
    // the user aborted during the first tool's prompt, awaiting the broker would hang the loop. The
    // gate must short-circuit to deny and must NOT open a prompt. (If this regressed, this test
    // would hang to the vitest timeout rather than fail fast.)
    const { engine } = makeEngine({ mode: "default" });
    const ac = new AbortController();
    ac.abort();
    let prompted = false;
    const decision = await engine.check(tool("write_file", false), { path: "/a" }, {
      emit: () => {
        prompted = true;
      },
      signal: ac.signal,
    });
    expect(decision.behavior).toBe("deny");
    expect(prompted).toBe(false);
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

  it("catastrophic-command tripwire: forces a prompt even under a broad allow rule", async () => {
    const { engine, broker } = makeEngine({ mode: "default", allow: ["Bash(rm:*)"] });

    // A scoped delete the user opted into auto-runs with no prompt.
    let asked = false;
    const safe = await engine.check(tool("Bash", false), { command: "rm -rf node_modules" }, {
      emit: (e) => {
        if (e.type === "permission_request") asked = true;
      },
      signal,
    });
    expect(safe.behavior).toBe("allow");
    expect(asked).toBe(false);

    // But `rm -rf ~` is catastrophic: the same allow rule does NOT cover it — it asks.
    let risk: unknown;
    const danger = await engine.check(tool("Bash", false), { command: "rm -rf ~" }, {
      emit: (e) => {
        if (e.type === "permission_request") {
          risk = e.risk;
          broker.resolve(e.requestId, { behavior: "deny" });
        }
      },
      signal,
    });
    expect(danger.behavior).toBe("deny");
    expect(risk).toMatchObject({ level: "destructive" });
  });

  it("the tripwire fires under acceptEdits too (the runtime's default mode)", async () => {
    const { engine, broker } = makeEngine({ mode: "acceptEdits", allow: ["Bash(rm:*)"] });
    let asked = false;
    const run = await engine.check(tool("Bash", false), { command: "rm -rf ~" }, {
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

  it("plan mode: no allow rule DENIES outright; a matching allow rule is escalated to ASK (not auto-run)", async () => {
    // (a) No rule: plan denies mutating tools at the mode gate — the tripwire never weakens that.
    const noRule = makeEngine({ mode: "plan" });
    let askedA = false;
    const denied = await noRule.engine.check(tool("Bash", false), { command: "rm -rf /" }, {
      emit: (e) => {
        if (e.type === "permission_request") askedA = true;
      },
      signal,
    });
    expect(denied.behavior).toBe("deny");
    expect(askedA).toBe(false);

    // (b) With a broad allow rule, gate 4 would auto-allow even in plan mode (allow beats the
    // mode gate). The tripwire intercepts that, escalating the catastrophic command to a prompt.
    const withRule = makeEngine({ mode: "plan", allow: ["Bash(rm:*)"] });
    let askedB = false;
    const escalated = await withRule.engine.check(tool("Bash", false), { command: "rm -rf ~" }, {
      emit: (e) => {
        if (e.type === "permission_request") {
          askedB = true;
          withRule.broker.resolve(e.requestId, { behavior: "deny" });
        }
      },
      signal,
    });
    expect(askedB).toBe(true); // NOT auto-allowed by the rule
    expect(escalated.behavior).toBe("deny");
  });

  it("an ask rule does not clobber the catastrophic warning message", async () => {
    const { engine, broker } = makeEngine({ mode: "default", ask: ["Bash(rm:*)"] });
    let reason = "";
    await engine.check(tool("Bash", false), { command: "rm -rf ~" }, {
      emit: (e) => {
        if (e.type === "permission_request") {
          reason = e.reason;
          broker.resolve(e.requestId, { behavior: "deny" });
        }
      },
      signal,
    });
    expect(reason).toMatch(/irreversibly destructive/); // catastrophic text wins over the ask-rule text
  });

  it("bypassPermissions is the explicit escape hatch — even catastrophic commands run", async () => {
    const { engine } = makeEngine({ mode: "bypassPermissions" });
    let asked = false;
    const run = await engine.check(tool("Bash", false), { command: "rm -rf /" }, {
      emit: (e) => {
        if (e.type === "permission_request") asked = true;
      },
      signal,
    });
    expect(run.behavior).toBe("allow");
    expect(asked).toBe(false);
  });

  it("auto mode runs every tool without prompting (full autonomy)", async () => {
    const { engine } = makeEngine({ mode: "auto" });
    let asked = false;
    const emit: EventSink = (e) => {
      if (e.type === "permission_request") asked = true;
    };
    expect((await engine.check(tool("read_file", true), {}, { emit, signal })).behavior).toBe("allow");
    expect((await engine.check(tool("Write", false), { file_path: "/a" }, { emit, signal })).behavior).toBe("allow");
    expect((await engine.check(tool("Bash", false), { command: "npm test" }, { emit, signal })).behavior).toBe("allow");
    expect(asked).toBe(false); // nothing prompted — fully automatic
  });

  it("auto mode keeps the safety floor: a catastrophic command STILL escalates to a human prompt", async () => {
    const { engine, broker } = makeEngine({ mode: "auto" });
    let asked = false;
    const run = await engine.check(tool("Bash", false), { command: "rm -rf ~" }, {
      emit: (e) => {
        if (e.type === "permission_request") {
          asked = true;
          broker.resolve(e.requestId, { behavior: "deny" });
        }
      },
      signal,
    });
    expect(asked).toBe(true); // unlike bypass, auto does not silently run a catastrophic command
    expect(run.behavior).toBe("deny");
  });

  it("auto mode keeps the safety floor: protected paths are still denied", async () => {
    const { engine } = makeEngine({ mode: "auto" });
    const res = await engine.check(tool("write_file", false), { path: "/.git/config" }, { emit: () => {}, signal });
    expect(res.behavior).toBe("deny");
  });

  it("auto mode floor holds even against a hook-allow: a catastrophic command STILL escalates", async () => {
    // Regression: a PreToolUse hook returning allow (with updatedInput) used to short-circuit BEFORE
    // risk classification, letting a hook-allowed `rm -rf ~` run silently. The floor now outranks the hook.
    const hooks = new HookBus().onPreToolUse(() => ({ decision: "allow", updatedInput: { command: "rm -rf ~" } }));
    const { engine, broker } = makeEngine({ mode: "auto", hooks });
    let asked = false;
    const run = await engine.check(tool("Bash", false), { command: "rm -rf ~" }, {
      emit: (e) => {
        if (e.type === "permission_request") {
          asked = true;
          broker.resolve(e.requestId, { behavior: "deny" });
        }
      },
      signal,
    });
    expect(asked).toBe(true); // hook-allow does NOT bypass the catastrophic floor
    expect(run.behavior).toBe("deny");
  });

  it("a non-catastrophic hook-allow still short-circuits to allow (no regression)", async () => {
    const hooks = new HookBus().onPreToolUse(() => ({ decision: "allow", updatedInput: { command: "npm test" } }));
    const { engine } = makeEngine({ mode: "default", hooks });
    let asked = false;
    const run = await engine.check(tool("Bash", false), { command: "npm test" }, {
      emit: (e) => {
        if (e.type === "permission_request") asked = true;
      },
      signal,
    });
    expect(asked).toBe(false);
    expect(run.behavior).toBe("allow");
    expect(run.behavior === "allow" && run.decisionReason.type).toBe("hook");
  });

  it("auto mode keeps the safety floor: a matching ask rule STILL forces a human prompt", async () => {
    const { engine, broker } = makeEngine({ mode: "auto", ask: ["Bash(git push:*)"] });
    let asked = false;
    const run = await engine.check(tool("Bash", false), { command: "git push origin main" }, {
      emit: (e) => {
        if (e.type === "permission_request") {
          asked = true;
          broker.resolve(e.requestId, { behavior: "allow" });
        }
      },
      signal,
    });
    expect(asked).toBe(true);
    expect(run.behavior).toBe("allow");
  });

  it("auto mode: an explicit deny rule still denies (deny beats mode)", async () => {
    const { engine } = makeEngine({ mode: "auto", deny: ["Bash(curl:*)"] });
    const r = await engine.check(tool("Bash", false), { command: "curl http://example.com" }, { emit: () => {}, signal });
    expect(r.behavior).toBe("deny");
  });

  it("attaches advisory risk to a Bash permission_request, and nothing to other tools", async () => {
    const { engine, broker } = makeEngine({ mode: "default" });
    let bashRisk: unknown;
    await engine.check(tool("Bash", false), { command: "npm install" }, {
      emit: (e) => {
        if (e.type === "permission_request") {
          bashRisk = e.risk;
          broker.resolve(e.requestId, { behavior: "deny" });
        }
      },
      signal,
    });
    expect(bashRisk).toMatchObject({ level: "network", category: "install" });

    let otherRisk: unknown = "unset";
    await engine.check(tool("write_file", false), { path: "/a" }, {
      emit: (e) => {
        if (e.type === "permission_request") {
          otherRisk = e.risk;
          broker.resolve(e.requestId, { behavior: "deny" });
        }
      },
      signal,
    });
    expect(otherRisk).toBeUndefined();
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

describe("HookBus lifecycle", () => {
  it("runSessionStart collects the strings hooks return as additional context", async () => {
    const bus = new HookBus()
      .onSessionStart(() => "CTX_A")
      .onSessionStart(() => undefined) // no contribution
      .onSessionStart(() => "CTX_B");
    expect(await bus.runSessionStart({ sessionId: "s" })).toEqual(["CTX_A", "CTX_B"]);
  });

  it("runStop aggregates blockingErrors and any preventContinuation", async () => {
    const bus = new HookBus()
      .onStop(() => ({ blockingErrors: ["a"] }))
      .onStop(() => undefined)
      .onStop(() => ({ blockingErrors: ["b"], preventContinuation: true }));
    const agg = await bus.runStop({ sessionId: "s" });
    expect(agg.blockingErrors).toEqual(["a", "b"]);
    expect(agg.preventContinuation).toBe(true);
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

describe("plan-mode allowedPrompts", () => {
  it("exitPlanMode pre-approves the declared commands as session allow-rules", async () => {
    const { engine, broker } = makeEngine({ mode: "plan" });
    engine.exitPlanMode([{ tool: "Bash", prompt: "npm test" }]);
    expect(engine.getMode()).toBe("acceptEdits");

    // 'npm test' (and its variants) auto-allow; 'npm publish' still asks.
    const allowed = await engine.check(tool("Bash", false), { command: "npm test --watch" }, { emit: () => {}, signal });
    expect(allowed.behavior).toBe("allow");
    expect(allowed.decisionReason.type).toBe("rule");

    let asked = false;
    const other = await engine.check(tool("Bash", false), { command: "npm publish" }, {
      emit: (e) => {
        if (e.type === "permission_request") {
          asked = true;
          broker.resolve(e.requestId, { behavior: "deny" });
        }
      },
      signal,
    });
    expect(asked).toBe(true);
    expect(other.behavior).toBe("deny");
  });
});
