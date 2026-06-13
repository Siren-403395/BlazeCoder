import { describe, expect, it } from "vitest";
import { applyEvent, initialState, runStats, type UiAction } from "@/lib/agentState";

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

  it("counts model turns live as assistant events arrive", () => {
    const s = run([
      { type: "assistant", text: "first turn", toolCalls: [] },
      { type: "assistant", text: "", toolCalls: [{ id: "c", name: "write_file", input: { path: "/a.ts" } }] },
    ]);
    expect(runStats(s).numTurns).toBe(2);
  });

  it("counts compactions and logs a boundary", () => {
    const s = run([{ type: "compact_boundary", reason: "limit", tokensBefore: 10, tokensAfter: 5 }]);
    expect(s.compactions).toBe(1);
    expect(s.trace.at(-1)?.kind).toBe("compact");
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
