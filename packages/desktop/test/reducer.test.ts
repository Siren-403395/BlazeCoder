import { describe, expect, it } from "vitest";
import type { FileDiff } from "@blazecoder/shared";
import { reduce, reduceAll } from "../src/renderer/app/reducer";
import { initialUiState } from "../src/renderer/app/types";
import type { AssistantItem, SubagentItem, ToolItem } from "../src/renderer/app/types";

const find = <K extends string>(state: { timeline: { kind: string }[] }, kind: K) =>
  state.timeline.find((i) => i.kind === kind);

describe("renderer reducer — AgentEvent contract fidelity", () => {
  it("opens an assistant item on a delta with no open assistant, then concatenates", () => {
    const s = reduceAll([
      { type: "assistant_delta", text: "Hel" },
      { type: "assistant_delta", text: "lo" },
    ]);
    const a = find(s, "assistant") as AssistantItem | undefined;
    expect(a?.text).toBe("Hello");
    expect(a?.complete).toBe(false);
    expect(s.timeline.filter((i) => i.kind === "assistant")).toHaveLength(1);
  });

  it("appends reasoning into the open assistant and finalizes on `assistant`", () => {
    const s = reduceAll([
      { type: "assistant_delta", text: "answer" },
      { type: "reasoning_delta", text: "think" },
      { type: "assistant", text: "answer", reasoning: "think", toolCalls: [] },
    ]);
    const a = find(s, "assistant") as AssistantItem | undefined;
    expect(a?.complete).toBe(true);
    expect(a?.reasoning).toBe("think");
    expect(s.liveAssistantId).toBeUndefined();
  });

  it("a tool_call mid-stream and the final assistant converge to ONE tool row (dedup by toolUseId)", () => {
    const s = reduceAll([
      { type: "assistant_delta", text: "let me read" },
      { type: "tool_call", id: "t1", name: "Read", input: { file_path: "a.ts" } },
      { type: "assistant", text: "let me read", reasoning: "", toolCalls: [{ id: "t1", name: "Read", input: { file_path: "a.ts" } }] },
    ]);
    expect(s.selectedToolId).toBe("t1");
    expect(s.timeline.filter((i) => i.kind === "tool")).toHaveLength(1);
    expect((find(s, "assistant") as AssistantItem).complete).toBe(true);
  });

  it("drops tool_args_delta from the timeline entirely", () => {
    const s = reduce(initialUiState, { type: "tool_args_delta", text: '{"x":1}' });
    expect(s.timeline).toHaveLength(0);
  });

  it("patches a tool row on tool_result and attaches a diff on file_change", () => {
    const diff: FileDiff = { op: "write", added: 2, removed: 0, hunks: [], truncated: false };
    const s = reduceAll([
      { type: "tool_call", id: "t1", name: "Write", input: { file_path: "a.ts" } },
      { type: "tool_result", toolUseId: "t1", name: "Write", content: "ok", isError: false, durationMs: 12 },
      { type: "file_change", op: "write", path: "a.ts", toolUseId: "t1", diff },
    ]);
    const t = find(s, "tool") as ToolItem | undefined;
    expect(t?.output).toBe("ok");
    expect(t?.durationMs).toBe(12);
    expect(t?.diff).toBe(diff);
    expect(t?.filePath).toBe("a.ts");
  });

  it("gives each subagent start its own row (unique id), and end marks the last running match done", () => {
    let s = reduce(initialUiState, { type: "subagent", phase: "start", agentType: "Explore", description: "scan" });
    s = reduce(s, { type: "subagent", phase: "start", agentType: "Explore", description: "scan" });
    const subs = s.timeline.filter((i): i is SubagentItem => i.kind === "subagent");
    expect(subs).toHaveLength(2);
    expect(new Set(subs.map((i) => i.id)).size).toBe(2); // unique React keys — no collision
    s = reduce(s, { type: "subagent", phase: "end", agentType: "Explore", description: "scan", turns: 3, summary: "done" });
    const after = s.timeline.filter((i): i is SubagentItem => i.kind === "subagent");
    expect(after.filter((x) => x.running)).toHaveLength(1);
    expect(after.filter((x) => !x.running)).toHaveLength(1);
    expect(after.find((x) => !x.running)?.summary).toBe("done");
  });

  it("a result with an error/cap subtype interrupts streamed-but-unexecuted tool rows", () => {
    const s = reduceAll([
      { type: "tool_call", id: "t1", name: "Bash", input: { command: "x" } },
      {
        type: "result",
        subtype: "error_max_turns",
        numTurns: 24,
        sessionId: "s",
        stopReason: null,
        totalCostUsd: 0,
        usage: { inputTokens: 0, outputTokens: 0 },
        summary: "hit cap",
      },
    ]);
    const t = find(s, "tool") as ToolItem;
    expect(t.isError).toBe(true);
    expect(t.output).toBe("(interrupted)");
    expect(s.status).toBe("idle");
  });

  it("sets awaiting_permission on permission_request, then returns to idle on result", () => {
    let s = reduce(initialUiState, {
      type: "permission_request",
      requestId: "r1",
      toolName: "Bash",
      input: { command: "ls" },
      reason: "needs approval",
    });
    expect(s.status).toBe("awaiting_permission");
    expect(s.permission?.requestId).toBe("r1");
    s = reduce(s, {
      type: "result",
      subtype: "success",
      numTurns: 1,
      sessionId: "sess",
      stopReason: "end_turn",
      totalCostUsd: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
      summary: "ok",
    });
    expect(s.status).toBe("idle");
    expect(s.permission).toBeNull();
    expect(s.timeline.some((i) => i.kind === "boundary")).toBe(true);
  });

  it("run_settled(error) finalizes a streaming assistant and marks pending tools interrupted", () => {
    const s = reduceAll([
      { type: "assistant_delta", text: "working" },
      { type: "tool_call", id: "t1", name: "Bash", input: { command: "sleep 99" } },
      { type: "run_settled", error: true },
    ]);
    expect((find(s, "assistant") as AssistantItem).complete).toBe(true);
    const t = find(s, "tool") as ToolItem;
    expect(t.isError).toBe(true);
    expect(s.status).toBe("idle");
  });

  it("tracks system init, user prompt, budget and todos", () => {
    let s = reduce(initialUiState, { type: "system", subtype: "init", sessionId: "sess", model: "m", tools: [], contextTokens: 1000 });
    expect(s.budget).toEqual({ totalTokens: 1000, usedTokens: 0, remainingTokens: 1000 });
    expect(s.model).toBe("m");
    s = reduce(s, { type: "user_prompt", text: "hi" });
    expect(s.status).toBe("running");
    expect(find(s, "user")).toBeTruthy();
    s = reduce(s, { type: "budget", totalTokens: 1000, usedTokens: 300, remainingTokens: 700 });
    expect(s.budget?.usedTokens).toBe(300);
    s = reduce(s, { type: "todos", items: [{ content: "a", status: "pending", activeForm: "doing a" }] });
    expect(s.todos).toHaveLength(1);
  });

  it("reset clears the timeline but keeps the model", () => {
    const s = reduceAll([
      { type: "system", subtype: "init", sessionId: "s", model: "m", tools: [], contextTokens: 10 },
      { type: "user_prompt", text: "hi" },
      { type: "reset" },
    ]);
    expect(s.timeline).toHaveLength(0);
    expect(s.model).toBe("m");
    expect(s.status).toBe("idle");
  });
});
