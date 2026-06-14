import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@zephyrcode/shared";
import {
  createAgentRuntime,
  FixedClock,
  InMemoryMemoryStore,
  InMemorySessionStore,
  InMemoryWorkspace,
  silentLogger,
} from "../src/index";
import type { AgentRuntimeOptions, ModelGateway, ModelResponse } from "../src/index";
import {
  call,
  reply,
  ScriptedGateway,
  StreamingScriptedGateway,
  type Step,
  writeFullProjectCalls,
} from "./fakes";

function makeRuntime(steps: Step[], extra: Partial<AgentRuntimeOptions> = {}) {
  const clock = new FixedClock(1);
  return createAgentRuntime({
    gateway: new ScriptedGateway("deepseek-chat", steps),
    sessionStore: new InMemorySessionStore(clock),
    memory: new InMemoryMemoryStore(),
    workspace: extra.workspace ?? new InMemoryWorkspace(),
    clock,
    logger: silentLogger,
    ...extra,
  });
}

function sink() {
  const events: AgentEvent[] = [];
  return { emit: (e: AgentEvent) => events.push(e), events };
}

const signal = () => new AbortController().signal;

describe("AgentRuntime end-to-end (scripted model)", () => {
  it("writes a full project across a turn and finishes successfully", async () => {
    const ws = new InMemoryWorkspace();
    const rt = makeRuntime(
      [reply("Creating files.", writeFullProjectCalls()), reply("Done, a Hello app.", [])],
      { workspace: ws },
    );
    const { emit, events } = sink();
    const { session, result } = await rt.run({ prompt: "make a hello app" }, emit, signal());

    expect(result.subtype).toBe("success");
    expect(result.numTurns).toBe(1);
    expect(result.totalCostUsd).toBeGreaterThan(0);
    expect(await ws.walk()).toHaveLength(6);

    expect(events[0]!.type).toBe("system");
    expect(events.at(-1)!.type).toBe("result");
    expect(events.filter((e) => e.type === "file_change")).toHaveLength(6);
    expect(events.some((e) => e.type === "budget")).toBe(true);

    const sessions = await rt.listSessions();
    expect(sessions).toHaveLength(1);
    const reloaded = await rt.getSession(session.id);
    expect(reloaded?.cwd).toBe(ws.root);
  });

  it("stops at the turn cap", async () => {
    const rt = makeRuntime([() => reply("looping", [call("l", "Glob", { pattern: "**/*" })])], { maxTurns: 2 });
    const { emit, events } = sink();
    const { result } = await rt.run({ prompt: "x" }, emit, signal());
    expect(result.subtype).toBe("error_max_turns");
    expect(result.numTurns).toBe(3);
    expect(events.some((e) => e.type === "notice" && e.level === "warn")).toBe(true);
  });

  it("blocks a write to a secret file via the secrets hook and survives", async () => {
    const rt = makeRuntime([
      reply("", [call("w", "Write", { file_path: "/.env", content: "TOKEN=value" })]),
      reply("Recovered.", []),
    ]);
    const { emit, events } = sink();
    const { result } = await rt.run({ prompt: "x" }, emit, signal());

    expect(result.subtype).toBe("success");
    const toolResult = events.find((e) => e.type === "tool_result" && e.toolUseId === "w");
    expect(toolResult && toolResult.type === "tool_result" && toolResult.isError).toBe(true);
    expect(events.some((e) => e.type === "file_change")).toBe(false);
  });

  it("streams reasoning when thinking is enabled, and persists + rehydrates it", async () => {
    const REASONING = "Let me think about this carefully before answering.";
    const gateway = new StreamingScriptedGateway("deepseek-v4-pro", [reply("Done.", [], REASONING)]);
    const clock = new FixedClock(1);
    const rt = createAgentRuntime({
      gateway,
      sessionStore: new InMemorySessionStore(clock),
      memory: new InMemoryMemoryStore(),
      workspace: new InMemoryWorkspace(),
      clock,
      logger: silentLogger,
    });
    const { emit, events } = sink();
    const { session, result } = await rt.run({ prompt: "hard question", effort: "high" }, emit, signal());

    expect(result.subtype).toBe("success");
    // The high-effort run enabled thinking mode on the model request.
    expect(gateway.lastRequest?.thinking).toBe(true);
    // Reasoning arrived as MULTIPLE streamed deltas (never one synchronous blob).
    const deltas = events.filter((e) => e.type === "reasoning_delta");
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.map((e) => (e.type === "reasoning_delta" ? e.text : "")).join("")).toBe(REASONING);
    // The assembled reasoning rides the final assistant event...
    const asst = events.find((e) => e.type === "assistant");
    expect(asst?.type === "assistant" && asst.reasoning).toBe(REASONING);
    // ...is persisted on the transcript, and survives a reload (resume shows it).
    const reloaded = await rt.getSession(session.id);
    const stored = reloaded?.messages.find((m) => m.role === "assistant");
    expect(stored?.role === "assistant" && stored.reasoning).toBe(REASONING);
  });

  it("forwards gateway retry attempts to the UI as api_retry events", async () => {
    const gateway: ModelGateway = {
      model: "m",
      async complete() {
        return reply("done", []);
      },
      async stream(_req, _sig, handlers) {
        handlers.onRetry?.({ attempt: 1, maxRetries: 8, delayMs: 5, status: 503 });
        handlers.onRetry?.({ attempt: 2, maxRetries: 8, delayMs: 10, status: 503 });
        handlers.onText("done");
        return reply("done", []);
      },
    };
    const clock = new FixedClock(1);
    const rt = createAgentRuntime({
      gateway,
      sessionStore: new InMemorySessionStore(clock),
      memory: new InMemoryMemoryStore(),
      workspace: new InMemoryWorkspace(),
      clock,
      logger: silentLogger,
    });
    const { emit, events } = sink();
    const { result } = await rt.run({ prompt: "x" }, emit, signal());
    expect(result.subtype).toBe("success");
    const retries = events.filter((e) => e.type === "api_retry");
    expect(retries).toHaveLength(2);
    expect(retries[0]).toMatchObject({ attempt: 1, status: 503 });
  });

  it("runs a model-callable Task sub-agent and enforces no-nesting (terminates)", async () => {
    // main → Task(explorer); sub tries to nest Task (refused), then finishes; main finishes.
    // The whole thing TERMINATING is the proof that nesting is refused (no infinite spawn).
    const rt = makeRuntime([
      reply("", [call("t", "Task", { description: "look around", subagent_type: "explorer", prompt: "investigate" })]),
      reply("", [call("nested", "Task", { description: "go deeper", prompt: "nest" })]), // sub-agent turn 1
      reply("sub: nesting was refused; investigation complete.", []), // sub-agent turn 2
      reply("Done — the sub reported back.", []), // main turn 2
    ]);
    const { emit, events } = sink();
    const { result } = await rt.run({ prompt: "delegate" }, emit, signal());

    expect(result.subtype).toBe("success");
    // The sub-agent's distilled report came back as the main Task tool_result.
    const taskResult = events.find((e) => e.type === "tool_result" && e.toolUseId === "t");
    expect(taskResult && taskResult.type === "tool_result" && taskResult.content).toContain("investigation complete");
    // subagent start/end events bracket the run with the right agent type.
    const subEvents = events.filter((e): e is Extract<AgentEvent, { type: "subagent" }> => e.type === "subagent");
    expect(subEvents.map((e) => e.phase)).toEqual(["start", "end"]);
    expect(subEvents[0]!.agentType).toBe("explorer");
    expect(subEvents[1]!.subtype).toBe("success");
  });

  it("fires the lifecycle hooks (SessionStart context, Stop, SessionEnd) and survives a throwing hook", async () => {
    const fired: string[] = [];
    const rt = makeRuntime([reply("done", [])]);
    rt.hooks.onSessionStart(() => {
      fired.push("start");
      return "SESSION_CONTEXT_MARKER";
    });
    rt.hooks.onStop(() => {
      fired.push("stop");
    });
    rt.hooks.onSessionEnd(() => {
      fired.push("end");
      throw new Error("boom"); // a failing hook must not break the run
    });
    const { emit, events } = sink();
    const { session, result } = await rt.run({ prompt: "go" }, emit, signal());

    expect(result.subtype).toBe("success");
    expect(fired).toEqual(["start", "stop", "end"]);
    // SessionStart's returned context landed as a user message before the loop ran.
    expect(session.messages.some((m) => m.role === "user" && m.content === "SESSION_CONTEXT_MARKER")).toBe(true);
    // The throwing SessionEnd hook only produced a warn notice.
    expect(events.some((e) => e.type === "notice" && e.level === "warn" && /SessionEnd/.test(e.message))).toBe(true);
  });

  it("recovers from output truncation by nudging the model to resume in smaller pieces", async () => {
    const truncated = (text: string): ModelResponse => ({
      text,
      toolCalls: [],
      stopReason: "max_tokens",
      usage: { inputTokens: 10, outputTokens: 5 },
      costUsd: 0,
    });
    // Output is sized to the whole remaining window, so there's no budget to escalate to:
    // max_tokens (keep partial + nudge resume) → end_turn (complete).
    const rt = makeRuntime([truncated("partial 1"), reply("final answer", [])]);
    const { emit, events } = sink();
    const { session, result } = await rt.run({ prompt: "write a long thing" }, emit, signal());

    expect(result.subtype).toBe("success");
    expect(result.summary).toBe("final answer");
    // Truncation → a warn resume nudge (no "larger budget" escalation anymore).
    expect(events.some((e) => e.type === "notice" && e.level === "warn" && /resume/i.test(e.message))).toBe(true);
    // The resume nudge landed in the transcript.
    expect(session.messages.some((m) => m.role === "user" && /Output token limit hit/.test(m.content))).toBe(true);
  });

  it("injects a corrective message after repeated tool denials (no infinite thrash)", async () => {
    // A model that keeps calling a denied tool; a deny rule rejects Bash every turn.
    const rt = makeRuntime([() => reply("", [call("b", "Bash", { command: "ls" })])], { deny: ["Bash"], maxTurns: 8 });
    const { emit, events } = sink();
    const { session } = await rt.run({ prompt: "go" }, emit, signal());

    expect(session.messages.some((m) => m.role === "user" && /previous tool call\(s\) were rejected/.test(m.content))).toBe(true);
    expect(events.some((e) => e.type === "notice" && /change approach/.test(e.message))).toBe(true);
  });

  it("compact() is a no-op with no session id, and reports empty", async () => {
    const rt = makeRuntime([reply("done", [])]);
    const { emit, events } = sink();
    const outcome = await rt.compact(undefined, emit, signal());
    expect(outcome.status).toBe("empty");
    expect(events).toHaveLength(0); // nothing emitted when there's no session
  });

  it("compact() summarizes a live session on demand, marks it manual, and persists", async () => {
    // A compaction window that keeps just the last message, so a short transcript still
    // has a head to summarize (the real defaults wait for ~1M tokens).
    const rt = makeRuntime([reply("Creating files.", writeFullProjectCalls()), reply("All done.", [])], {
      compaction: { summaryKeepMinMessages: 1, summaryKeepMinTokens: 0, summaryKeepMaxTokens: 1_000_000 },
    });
    const run = await rt.run({ prompt: "make a hello app" }, sink().emit, signal());

    const { emit, events } = sink();
    const outcome = await rt.compact(run.session.id, emit, signal());

    expect(outcome.status).toBe("compacted");
    expect(outcome.summarized).toBe(true);
    // The ⟳ chip + a refreshed context gauge were emitted.
    const boundary = events.find((e) => e.type === "compact_boundary");
    expect(boundary && boundary.type === "compact_boundary" && /manual compaction/.test(boundary.reason)).toBe(true);
    expect(events.some((e) => e.type === "budget")).toBe(true);
    // The persisted transcript now leads with a manual summary block.
    const reloaded = await rt.getSession(run.session.id);
    const head = reloaded!.messages[0]!;
    expect(head.role).toBe("summary");
    expect(head.role === "summary" && head.boundary?.compactType).toBe("manual");
    // The stale authoritative count is cleared so the next turn doesn't re-compact.
    expect(reloaded!.lastRealInputTokens).toBeUndefined();
  });

  it("compact() propagates an abort during summarization (so the UI can show 'interrupted')", async () => {
    // A gateway that fails fast once the signal is aborted (like the real fetch adapter).
    const gateway: ModelGateway = {
      model: "m",
      async complete(_req, sig) {
        if (sig?.aborted) throw new Error("aborted");
        return reply("ok", []);
      },
    };
    const clock = new FixedClock(1);
    const rt = createAgentRuntime({
      gateway,
      sessionStore: new InMemorySessionStore(clock),
      memory: new InMemoryMemoryStore(),
      workspace: new InMemoryWorkspace(),
      clock,
      logger: silentLogger,
      compaction: { summaryKeepMinMessages: 1, summaryKeepMinTokens: 0, summaryKeepMaxTokens: 1_000_000 },
    });
    const run = await rt.run({ prompt: "hi" }, sink().emit, signal());

    const ac = new AbortController();
    ac.abort(); // user pressed Esc before the summarize call returns
    await expect(rt.compact(run.session.id, sink().emit, ac.signal)).rejects.toThrow();
  });

  it("resumes an existing session", async () => {
    const rt = makeRuntime([
      reply("one", [call("m", "memory", { command: "view" })]),
      reply("first done", []),
      reply("second done", []),
    ]);
    const { emit } = sink();
    const first = await rt.run({ prompt: "start" }, emit, signal());
    const second = await rt.run({ prompt: "continue", sessionId: first.session.id }, emit, signal());
    expect(second.session.id).toBe(first.session.id);
    expect(second.result.subtype).toBe("success");
  });
});
