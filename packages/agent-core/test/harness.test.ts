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
import { ContextOverflowError } from "../src/index";
import type { AgentLoopDeps, LoopState, ModelGateway, ModelResponse, SessionState } from "../src/index";
import { call, reply, ScriptedGateway, disabledSandbox, type Step } from "./fakes";

/** A gateway that throws ContextOverflowError the first `overflowTimes` calls, then succeeds. */
class OverflowGateway implements ModelGateway {
  readonly model = "m";
  calls = 0;
  constructor(private readonly overflowTimes: number) {}
  async complete(): Promise<ModelResponse> {
    this.calls += 1;
    if (this.calls <= this.overflowTimes) throw new ContextOverflowError();
    return reply("done", []);
  }
}

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
      stopBlocks: 0,
      hasReactiveCompacted: false,
    });
  });
});

function makeDeps(
  steps: Step[],
  onLoopState?: (s: LoopState) => void,
  extra: { hooks?: HookBus; steering?: { drain(): string[] }; gateway?: ModelGateway } = {},
): AgentLoopDeps {
  const clock = new FixedClock(1);
  const registry = new ToolRegistry().registerAll(builtinTools());
  const hooks = extra.hooks ?? new HookBus();
  const engine = new PermissionEngine({ mode: "bypassPermissions", hookBus: hooks, broker: new PermissionBroker(), idGen: () => "p" });
  return {
    gateway: extra.gateway ?? new ScriptedGateway("m", steps),
    registry,
    executor: new ToolExecutor(registry, engine, hooks, clock),
    contextManager: new ContextManager(DEFAULT_COMPACTION, clock, silentLogger),
    ledger: new ReadLedger(),
    sandbox: disabledSandbox,
    memory: new InMemoryMemoryStore(),
    clock,
    logger: silentLogger,
    config: { maxTurns: 24, maxBudgetUsd: 1, contextTokens: 65536, effort: "low" },
    hooks,
    steering: extra.steering,
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

  it("backfills synthetic tool_results so no tool_use is orphaned at max-turns", async () => {
    const deps = makeDeps([() => reply("loop", [call("g", "Glob", { pattern: "**/*" })])]);
    deps.config.maxTurns = 2;
    const s = session();
    await runAgentLoop(s, "go", new InMemoryWorkspace(), deps, () => {}, new AbortController().signal);
    const last = s.messages[s.messages.length - 1]!;
    expect(last.role).toBe("tool");
    expect(last.role === "tool" && last.results[0]).toMatchObject({ toolUseId: "g", content: "[Interrupted]", isError: true });
    // Every assistant tool_use now has a following tool result (no orphan).
    const lastAssistant = [...s.messages].reverse().find((m) => m.role === "assistant" && m.toolCalls.length > 0);
    expect(lastAssistant).toBeTruthy();
  });
});

describe("reactive compaction on context overflow", () => {
  it("compacts and retries once, then completes", async () => {
    const gw = new OverflowGateway(1);
    const deps = makeDeps([], undefined, { gateway: gw });
    const events: { type: string; message?: string }[] = [];
    const result = await runAgentLoop(session(), "go", new InMemoryWorkspace(), deps, (e) => events.push(e), new AbortController().signal);
    expect(result.subtype).toBe("success");
    expect(gw.calls).toBe(2); // overflow once → compact → retry succeeds
    expect(events.some((e) => e.type === "notice" && /compacting and retrying/.test(e.message ?? ""))).toBe(true);
  });

  it("a second overflow (guard set) is terminal", async () => {
    const gw = new OverflowGateway(2);
    const deps = makeDeps([], undefined, { gateway: gw });
    const result = await runAgentLoop(session(), "go", new InMemoryWorkspace(), deps, () => {}, new AbortController().signal);
    expect(result.subtype).toBe("error_during_execution"); // context_overflow → error_during_execution
    expect(gw.calls).toBe(2);
  });
});

describe("ToolExecutor.syntheticResults", () => {
  it("pairs one synthetic result per call", () => {
    const r = ToolExecutor.syntheticResults([call("a", "Read"), call("b", "Bash")]);
    expect(r.map((x) => x.toolUseId)).toEqual(["a", "b"]);
    expect(r.every((x) => x.isError && x.content === "[Interrupted]")).toBe(true);
  });
});

describe("between-turns steering", () => {
  it("folds a steered message into the conversation after a tool turn", async () => {
    let drained = false;
    const steering = {
      drain: () => {
        if (drained) return [];
        drained = true;
        return ["STEERED_INPUT"];
      },
    };
    // turn 1 calls a tool (so the continue point runs + drains), turn 2 finishes.
    const deps = makeDeps([reply("", [call("g", "Glob", { pattern: "**/*" })]), reply("done", [])], undefined, { steering });
    const s = session();
    await runAgentLoop(s, "go", new InMemoryWorkspace(), deps, () => {}, new AbortController().signal);
    expect(s.messages.some((m) => m.role === "user" && m.content === "STEERED_INPUT")).toBe(true);
  });
});

describe("blocking Stop hook (re-think loop)", () => {
  it("forces one more turn on blockingErrors, then completes", async () => {
    const hooks = new HookBus();
    let stopCalls = 0;
    hooks.onStop(() => {
      stopCalls += 1;
      return stopCalls === 1 ? { blockingErrors: ["keep going: also handle the edge case"] } : undefined;
    });
    const deps = makeDeps([reply("first pass done", []), reply("edge case handled", [])], undefined, { hooks });
    const s = session();
    const result = await runAgentLoop(s, "go", new InMemoryWorkspace(), deps, () => {}, new AbortController().signal);

    expect(result.subtype).toBe("success");
    expect(stopCalls).toBe(2); // blocked once, allowed the second time
    expect(s.messages.some((m) => m.role === "user" && /keep going/.test(m.content))).toBe(true);
  });

  it("caps re-think continuations so a hook that always blocks can't loop forever", async () => {
    const hooks = new HookBus();
    let stopCalls = 0;
    hooks.onStop(() => {
      stopCalls += 1;
      return { blockingErrors: ["again"] }; // always blocks
    });
    const deps = makeDeps([() => reply("done", [])], undefined, { hooks });
    const result = await runAgentLoop(session(), "go", new InMemoryWorkspace(), deps, () => {}, new AbortController().signal);
    expect(result.subtype).toBe("success"); // terminates despite the always-block hook
    expect(stopCalls).toBe(3); // capped at 3 continuations
  });
});
