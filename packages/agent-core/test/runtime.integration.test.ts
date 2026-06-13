import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@coding-agent/shared";
import {
  createAgentRuntime,
  FixedClock,
  InMemoryMemoryStore,
  InMemorySessionStore,
  silentLogger,
} from "../src/index";
import type { AgentRuntimeOptions } from "../src/index";
import { call, FakePreviewBuilder, reply, ScriptedGateway, type Step, writeFullProjectCalls } from "./fakes";

function makeRuntime(steps: Step[], extra: Partial<AgentRuntimeOptions> = {}) {
  const clock = new FixedClock(1);
  return createAgentRuntime({
    gateway: new ScriptedGateway("deepseek-chat", steps),
    previewBuilder: new FakePreviewBuilder(),
    sessionStore: new InMemorySessionStore(clock),
    memory: new InMemoryMemoryStore(),
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
  it("writes a full project, builds a preview, and finishes successfully", async () => {
    const rt = makeRuntime([
      reply("Creating files.", writeFullProjectCalls()),
      reply("Building.", [call("p", "build_preview")]),
      reply("Done — a Hello app.", []),
    ]);
    const { emit, events } = sink();
    const { session, result } = await rt.run({ prompt: "make a hello app" }, emit, signal());

    expect(result.subtype).toBe("success");
    expect(result.numTurns).toBe(2);
    expect(result.totalCostUsd).toBeGreaterThan(0);
    expect(session.project.files).toHaveLength(6);

    expect(events[0]!.type).toBe("system");
    expect(events.at(-1)!.type).toBe("result");
    expect(events.filter((e) => e.type === "file_change")).toHaveLength(6);
    expect(events.some((e) => e.type === "preview" && e.ok === true)).toBe(true);
    expect(events.some((e) => e.type === "budget")).toBe(true);

    const sessions = await rt.listSessions();
    expect(sessions).toHaveLength(1);
    const reloaded = await rt.getSession(session.id);
    expect(reloaded?.project.files).toHaveLength(6);
  });

  it("stops at the turn cap", async () => {
    const rt = makeRuntime([() => reply("looping", [call("l", "list_files")])], { maxTurns: 2 });
    const { emit, events } = sink();
    const { result } = await rt.run({ prompt: "x" }, emit, signal());
    expect(result.subtype).toBe("error_max_turns");
    expect(result.numTurns).toBe(3);
    expect(events.some((e) => e.type === "notice" && e.level === "warn")).toBe(true);
  });

  it("blocks an invalid write via the validation hook and survives", async () => {
    const rt = makeRuntime([
      reply("", [call("w", "write_file", { path: "/src/App.tsx", content: "" })]),
      reply("Recovered.", []),
    ]);
    const { emit, events } = sink();
    const { session, result } = await rt.run({ prompt: "x" }, emit, signal());

    expect(result.subtype).toBe("success");
    const toolResult = events.find((e) => e.type === "tool_result" && e.toolUseId === "w");
    expect(toolResult && toolResult.type === "tool_result" && toolResult.isError).toBe(true);
    expect(events.some((e) => e.type === "file_change")).toBe(false);
    expect(session.project.files).toHaveLength(0);
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
