import { describe, expect, it } from "vitest";
import {
  ContextManager,
  DEFAULT_COMPACTION,
  escalateOutputTokens,
  OUTPUT_TOKEN_CEILING,
  FixedClock,
  HookBus,
  InMemoryMemoryStore,
  InMemoryWorkspace,
  initialLoopState,
  PermissionBroker,
  PermissionEngine,
  ReadLedger,
  runAgentLoop,
  silentLogger,
  terminalToSubtype,
  ToolExecutor,
  ToolRegistry,
  builtinTools,
} from "../src/index";
import type { AgentLoopDeps, LoopState, SessionState } from "../src/index";
import { call, reply, ScriptedGateway, disabledSandbox, type Step } from "./fakes";

describe("terminalToSubtype", () => {
  it("maps every Terminal reason to the public ResultSubtype", () => {
    expect(terminalToSubtype({ reason: "completed" })).toBe("success");
    expect(terminalToSubtype({ reason: "max_turns" })).toBe("error_max_turns");
    expect(terminalToSubtype({ reason: "max_budget" })).toBe("error_max_budget_usd");
    expect(terminalToSubtype({ reason: "compaction_thrash" })).toBe("error_compaction_thrash");
    expect(terminalToSubtype({ reason: "aborted" })).toBe("cancelled");
    expect(terminalToSubtype({ reason: "model_error" })).toBe("error_during_execution");
    expect(terminalToSubtype({ reason: "context_overflow" })).toBe("error_during_execution");
  });

  it("escalateOutputTokens quadruples then caps at the ceiling", () => {
    expect(escalateOutputTokens(8000)).toBe(OUTPUT_TOKEN_CEILING); // 32000 (min(32000, ceiling))
    expect(escalateOutputTokens(OUTPUT_TOKEN_CEILING)).toBeUndefined(); // already capped
    expect(escalateOutputTokens(2000)).toBe(8000);
  });

  it("initialLoopState starts fresh", () => {
    expect(initialLoopState()).toEqual({
      turns: 0,
      transition: { reason: "next_turn" },
      recoveryCount: 0,
      hasReactiveCompacted: false,
    });
  });
});

function makeDeps(steps: Step[], onLoopState?: (s: LoopState) => void): AgentLoopDeps {
  const clock = new FixedClock(1);
  const registry = new ToolRegistry().registerAll(builtinTools());
  const hooks = new HookBus();
  const engine = new PermissionEngine({ mode: "bypassPermissions", hookBus: hooks, broker: new PermissionBroker(), idGen: () => "p" });
  return {
    gateway: new ScriptedGateway("m", steps),
    registry,
    executor: new ToolExecutor(registry, engine, hooks, clock),
    contextManager: new ContextManager(DEFAULT_COMPACTION, clock, silentLogger),
    ledger: new ReadLedger(),
    sandbox: disabledSandbox,
    memory: new InMemoryMemoryStore(),
    clock,
    logger: silentLogger,
    config: { maxTurns: 24, maxBudgetUsd: 1, contextTokens: 65536, effort: "low" },
    onLoopState,
  };
}

function session(): SessionState {
  return {
    id: "s",
    createdAt: 1,
    updatedAt: 1,
    model: "m",
    title: "t",
    messages: [],
    cwd: "/",
    turns: 0,
    costUsd: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    status: "idle",
  };
}

describe("agent loop reduces over immutable LoopState", () => {
  it("rebuilds a fresh LoopState per continue (no shared mutation)", async () => {
    const states: LoopState[] = [];
    // Two tool-call turns, then a plain answer → 3 iterations.
    const steps: Step[] = [
      reply("", [call("g1", "Glob", { pattern: "**/*" })]),
      reply("", [call("g2", "Glob", { pattern: "**/*.ts" })]),
      reply("done", []),
    ];
    const deps = makeDeps(steps, (s) => states.push(s));
    const ws = new InMemoryWorkspace();
    const result = await runAgentLoop(session(), "go", ws, deps, () => {}, new AbortController().signal);

    expect(result.subtype).toBe("success");
    expect(states.length).toBe(3);
    // turns advance 0 → 1 → 2 across iterations...
    expect(states.map((s) => s.turns)).toEqual([0, 1, 2]);
    // ...and each is a distinct object (rebuilt, never mutated in place).
    expect(new Set(states).size).toBe(3);
    for (const s of states) expect(s.transition.reason).toBe("next_turn");
  });

  it("maps the turn cap to error_max_turns through the single finish site", async () => {
    const deps = makeDeps([() => reply("loop", [call("g", "Glob", { pattern: "**/*" })])]);
    deps.config.maxTurns = 2;
    const result = await runAgentLoop(session(), "go", new InMemoryWorkspace(), deps, () => {}, new AbortController().signal);
    expect(result.subtype).toBe("error_max_turns");
  });
});
