import { describe, expect, it } from "vitest";
import type { SessionState } from "@coding-agent/shared";
import { applyEvent, fileList, initialState, runStats, type UiAction } from "@/lib/agentState";

function run(actions: UiAction[]) {
  return actions.reduce(applyEvent, initialState);
}

describe("applyEvent — extended behavior", () => {
  it("records the user's prompt and enters running", () => {
    const s = applyEvent(initialState, { type: "user_prompt", text: "make a counter" });
    expect(s.status).toBe("running");
    expect(s.trace.at(-1)).toMatchObject({ kind: "user", text: "make a counter" });
  });

  it("tracks a tool from running to ok, in place, with duration", () => {
    let s = run([
      { type: "assistant", text: "", toolCalls: [{ id: "call_1", name: "write_file", input: { path: "/a.ts" } }] },
    ]);
    expect(s.trace.find((t) => t.id === "call_1")?.status).toBe("running");

    s = applyEvent(s, {
      type: "tool_result",
      toolUseId: "call_1",
      name: "write_file",
      content: "Wrote /a.ts",
      isError: false,
      durationMs: 42,
    });
    const done = s.trace.find((t) => t.id === "call_1");
    expect(done?.status).toBe("ok");
    expect(done?.durationMs).toBe(42);
    expect(done?.text).toBe("Wrote /a.ts");
    expect(s.trace.filter((t) => t.kind === "tool")).toHaveLength(1); // updated, not duplicated
  });

  it("assembles a streamed turn without duplicating the message or tool row", () => {
    const s = run([
      { type: "assistant_delta", text: "Build" },
      { type: "assistant_delta", text: "ing it." },
      { type: "tool_call", id: "c1", name: "write_file", input: { path: "/a.tsx" } },
      { type: "assistant", text: "Building it.", toolCalls: [{ id: "c1", name: "write_file", input: { path: "/a.tsx" } }] },
    ]);
    const assistant = s.trace.filter((t) => t.kind === "assistant");
    expect(assistant).toHaveLength(1);
    expect(assistant[0]?.text).toBe("Building it.");
    expect(assistant[0]?.streaming).toBe(false);
    const tools = s.trace.filter((t) => t.kind === "tool");
    expect(tools.map((t) => t.id)).toEqual(["c1"]);
  });

  it("marks a failed tool as error", () => {
    const s = run([
      { type: "assistant", text: "", toolCalls: [{ id: "c", name: "run_command", input: { command: "x" } }] },
      { type: "tool_result", toolUseId: "c", name: "run_command", content: "boom", isError: true, durationMs: 1 },
    ]);
    expect(s.trace.find((t) => t.id === "c")?.status).toBe("error");
  });

  it("captures prevContent on edit for diffing", () => {
    const s = run([
      { type: "file_change", op: "write", path: "/a.ts", language: "ts", content: "v1" },
      { type: "file_change", op: "edit", path: "/a.ts", language: "ts", content: "v2" },
    ]);
    expect(s.files["/a.ts"]).toMatchObject({ content: "v2", prevContent: "v1", lastOp: "edit" });
  });

  it("counts tool-use turns only (a final no-tool answer is not a turn)", () => {
    const s = run([
      { type: "assistant", text: "step one", toolCalls: [{ id: "c", name: "write_file", input: { path: "/a.ts" } }] },
      { type: "assistant", text: "all done", toolCalls: [] },
    ]);
    expect(runStats(s).numTurns).toBe(1);
  });

  it("counts compactions and logs a boundary", () => {
    const s = run([{ type: "compact_boundary", reason: "limit", tokensBefore: 10, tokensAfter: 5 }]);
    expect(s.compactions).toBe(1);
    expect(s.trace.at(-1)?.kind).toBe("compact");
  });

  it("rehydrates UI state from a persisted session, and reset clears it", () => {
    const session: SessionState = {
      id: "sess-9",
      createdAt: 1,
      updatedAt: 2,
      model: "deepseek-chat",
      title: "Build 2048",
      messages: [
        { role: "user", content: "build 2048" },
        {
          role: "assistant",
          content: "Done.",
          toolCalls: [{ id: "w1", name: "write_file", input: { path: "/src/App.tsx" } }],
        },
        {
          role: "tool",
          results: [{ toolUseId: "w1", toolName: "write_file", content: "Wrote /src/App.tsx", isError: false }],
        },
      ],
      project: {
        projectName: "p",
        summary: "",
        features: [],
        runInstructions: "",
        files: [{ path: "/src/App.tsx", language: "tsx", content: "x" }],
      },
      turns: 1,
      costUsd: 0.02,
      usage: { inputTokens: 10, outputTokens: 5 },
      status: "done",
    };

    const s = applyEvent(initialState, { type: "hydrate", session });
    expect(s.sessionId).toBe("sess-9");
    expect(s.status).toBe("done");
    expect(fileList(s).map((f) => f.path)).toEqual(["/src/App.tsx"]);
    const tool = s.trace.find((t) => t.id === "w1");
    expect(tool?.status).toBe("ok");
    expect(tool?.text).toBe("Wrote /src/App.tsx");
    expect(s.trace.some((t) => t.kind === "user" && t.text === "build 2048")).toBe(true);

    expect(applyEvent(s, { type: "reset" })).toEqual(initialState);
  });

  it("summarizes run stats", () => {
    const s = run([
      { type: "system", subtype: "init", sessionId: "s", model: "deepseek", tools: [], maxTurns: 24, contextTokens: 65536 },
      { type: "file_change", op: "write", path: "/a.ts", language: "ts", content: "1" },
      { type: "budget", totalTokens: 100, usedTokens: 40, remainingTokens: 60 },
      { type: "result", subtype: "success", numTurns: 3, sessionId: "s", stopReason: "end_turn", totalCostUsd: 0.02, usage: { inputTokens: 5, outputTokens: 5 }, summary: "done" },
    ]);
    expect(runStats(s)).toMatchObject({
      model: "deepseek",
      numTurns: 3,
      maxTurns: 24,
      costUsd: 0.02,
      fileCount: 1,
    });
  });
});
