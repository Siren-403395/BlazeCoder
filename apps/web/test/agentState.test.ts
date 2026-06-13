import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@coding-agent/shared";
import { applyEvent, fileList, initialState } from "../src/lib/agentState";

function run(events: AgentEvent[]) {
  return events.reduce(applyEvent, initialState);
}

describe("applyEvent", () => {
  it("folds a full successful run into render state", () => {
    const state = run([
      { type: "system", subtype: "init", sessionId: "s1", model: "m", tools: ["write_file"], maxTurns: 24, contextTokens: 65536 },
      { type: "assistant", text: "Creating files.", toolCalls: [] },
      { type: "file_change", op: "write", path: "/src/App.tsx", language: "tsx", content: "export default 1" },
      { type: "file_change", op: "write", path: "/src/index.css", language: "css", content: "body{}" },
      { type: "tool_result", toolUseId: "1", name: "write_file", content: "Wrote /src/App.tsx", isError: false, durationMs: 1 },
      { type: "budget", totalTokens: 100, usedTokens: 30, remainingTokens: 70 },
      { type: "preview", ok: true, previewHtml: "<html>ok</html>" },
      { type: "result", subtype: "success", numTurns: 1, sessionId: "s1", stopReason: "end_turn", totalCostUsd: 0.01, usage: { inputTokens: 1, outputTokens: 1 }, summary: "Built it." },
    ]);

    expect(state.status).toBe("done");
    expect(state.sessionId).toBe("s1");
    expect(fileList(state).map((f) => f.path)).toEqual(["/src/App.tsx", "/src/index.css"]);
    expect(state.previewHtml).toBe("<html>ok</html>");
    expect(state.budget).toEqual({ totalTokens: 100, usedTokens: 30, remainingTokens: 70 });
    expect(state.resultSummary).toBe("Built it.");
    expect(state.trace.some((t) => t.kind === "assistant")).toBe(true);
    expect(state.trace.some((t) => t.kind === "tool")).toBe(true);
  });

  it("handles file edits and deletes", () => {
    const state = run([
      { type: "file_change", op: "write", path: "/a.ts", language: "ts", content: "1" },
      { type: "file_change", op: "edit", path: "/a.ts", language: "ts", content: "2" },
      { type: "file_change", op: "write", path: "/b.ts", language: "ts", content: "x" },
      { type: "file_change", op: "delete", path: "/b.ts" },
    ]);
    expect(state.files["/a.ts"]?.content).toBe("2");
    expect(state.files["/b.ts"]).toBeUndefined();
  });

  it("captures and clears a pending permission", () => {
    const asked = run([
      { type: "permission_request", requestId: "r1", toolName: "run_command", input: { command: "ls" }, reason: "ok?" },
    ]);
    expect(asked.status).toBe("awaiting_permission");
    expect(asked.pendingPermission?.requestId).toBe("r1");

    const resolved = applyEvent(asked, {
      type: "tool_result",
      toolUseId: "t",
      name: "run_command",
      content: "done",
      isError: false,
      durationMs: 1,
    });
    expect(resolved.pendingPermission).toBeUndefined();
  });

  it("records a preview build error without clobbering files", () => {
    const state = run([
      { type: "file_change", op: "write", path: "/a.ts", language: "ts", content: "1" },
      { type: "preview", ok: false, error: "boom" },
    ]);
    expect(state.previewError).toBe("boom");
    expect(state.files["/a.ts"]).toBeDefined();
  });

  it("marks error result status", () => {
    const state = run([
      { type: "result", subtype: "error_max_turns", numTurns: 24, sessionId: "s", stopReason: "end_turn", totalCostUsd: 0, usage: { inputTokens: 0, outputTokens: 0 }, summary: "too many" },
    ]);
    expect(state.status).toBe("error");
  });
});
