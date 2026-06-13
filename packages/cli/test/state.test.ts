import { describe, expect, it } from "vitest";
import { applyEvent, initialState, reduce, type Item, type UiAction } from "../src/tui/state";

function assistantItems(actions: UiAction[]) {
  return reduce(actions).items.filter((i): i is Extract<Item, { kind: "assistant" }> => i.kind === "assistant");
}

describe("TUI state reducer", () => {
  it("records the prompt and enters running", () => {
    const s = applyEvent(initialState(), { type: "user_prompt", text: "build a counter" });
    expect(s.status).toBe("running");
    expect(s.items.at(-1)).toMatchObject({ kind: "user", text: "build a counter" });
  });

  it("captures model/limits from the init event", () => {
    const s = applyEvent(initialState(), {
      type: "system",
      subtype: "init",
      sessionId: "s",
      model: "deepseek-v4-pro",
      tools: [],
      maxTurns: 24,
      contextTokens: 65536,
    });
    expect(s.model).toBe("deepseek-v4-pro");
    expect(s.maxTurns).toBe(24);
    expect(s.tokensTotal).toBe(65536);
  });

  it("assembles a streamed turn (reasoning + prose) into ONE assistant item, then finalizes", () => {
    const items = assistantItems([
      { type: "user_prompt", text: "go" },
      { type: "reasoning_delta", text: "Let me " },
      { type: "reasoning_delta", text: "plan." },
      { type: "assistant_delta", text: "Here" },
      { type: "assistant_delta", text: " it is." },
      { type: "assistant", text: "Here it is.", reasoning: "Let me plan.", toolCalls: [] },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]!.text).toBe("Here it is.");
    expect(items[0]!.reasoning).toBe("Let me plan.");
    expect(items[0]!.streaming).toBe(false);
  });

  it("tracks a tool from running to ok in place (no duplicate)", () => {
    const s = reduce([
      { type: "user_prompt", text: "go" },
      { type: "assistant", text: "", reasoning: undefined, toolCalls: [{ id: "c1", name: "Write", input: { file_path: "/a.ts" } }] },
      { type: "tool_call", id: "c1", name: "Write", input: { file_path: "/a.ts" } },
      { type: "tool_result", toolUseId: "c1", name: "Write", content: "Wrote /a.ts (1 line).", isError: false, durationMs: 5 },
    ]);
    const tools = s.items.filter((i) => i.kind === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ status: "ok", summary: "Wrote /a.ts (1 line).", durationMs: 5 });
  });

  it("marks a failed tool as error", () => {
    const s = reduce([
      { type: "tool_call", id: "c", name: "Bash", input: { command: "x" } },
      { type: "tool_result", toolUseId: "c", name: "Bash", content: "boom", isError: true, durationMs: 1 },
    ]);
    expect(s.items.find((i) => i.id === "c" && i.kind === "tool")).toMatchObject({ status: "error" });
  });

  it("enters awaiting_permission then clears it on the next prompt", () => {
    let s = reduce([
      { type: "permission_request", requestId: "r1", toolName: "Bash", input: { command: "rm x" }, reason: "Allow Bash?" },
    ]);
    expect(s.status).toBe("awaiting_permission");
    expect(s.permission?.requestId).toBe("r1");
    s = applyEvent(s, { type: "user_prompt", text: "next" });
    expect(s.permission).toBeUndefined();
  });

  it("updates the token gauge from budget events", () => {
    const s = reduce([{ type: "budget", totalTokens: 1000, usedTokens: 250, remainingTokens: 750 }]);
    expect(s.tokensUsed).toBe(250);
    expect(s.tokensTotal).toBe(1000);
  });

  it("logs a compaction boundary", () => {
    const s = reduce([{ type: "compact_boundary", reason: "summarized history", tokensBefore: 10, tokensAfter: 5 }]);
    expect(s.items.at(-1)).toMatchObject({ kind: "compact", reason: "summarized history" });
  });

  it("finishes: result sets status + stats and appends a result item", () => {
    const s = reduce([
      { type: "user_prompt", text: "go" },
      { type: "result", subtype: "success", numTurns: 2, sessionId: "s", stopReason: "end_turn", totalCostUsd: 0.02, usage: { inputTokens: 5, outputTokens: 5 }, summary: "Done." },
    ]);
    expect(s.status).toBe("done");
    expect(s.turns).toBe(2);
    expect(s.costUsd).toBe(0.02);
    expect(s.items.at(-1)).toMatchObject({ kind: "result", subtype: "success", summary: "Done." });
  });

  it("reset clears the transcript but keeps model, effort, and reasoning", () => {
    const s = reduce([
      { type: "set_effort", effort: "ultra" },
      { type: "set_reasoning", reasoning: "full" },
      { type: "system", subtype: "init", sessionId: "s", model: "m", tools: [], maxTurns: 24, contextTokens: 100 },
      { type: "user_prompt", text: "go" },
    ]);
    const cleared = applyEvent(s, { type: "reset" });
    expect(cleared.items).toHaveLength(0);
    expect(cleared.model).toBe("m");
    expect(cleared.effort).toBe("ultra");
    expect(cleared.reasoning).toBe("full");
    expect(cleared.status).toBe("idle");
  });

  it("defaults reasoning to summary and lets /reasoning change it", () => {
    expect(initialState().reasoning).toBe("summary");
    const s = applyEvent(initialState(), { type: "set_reasoning", reasoning: "hidden" });
    expect(s.reasoning).toBe("hidden");
  });

  it("hydrates scrollback from a persisted session (resume)", () => {
    const s = applyEvent(initialState(), {
      type: "hydrate",
      session: {
        id: "sess-1",
        createdAt: 1,
        updatedAt: 2,
        model: "deepseek-v4-pro",
        title: "build it",
        cwd: "/work",
        turns: 1,
        costUsd: 0.01,
        usage: { inputTokens: 10, outputTokens: 5 },
        status: "done",
        messages: [
          { role: "user", content: "make a counter" },
          { role: "assistant", content: "Done.", reasoning: "planned it", toolCalls: [{ id: "w1", name: "Write", input: { file_path: "/a.ts" } }] },
          { role: "tool", results: [{ toolUseId: "w1", toolName: "Write", content: "Wrote /a.ts (1 line).", isError: false }] },
        ],
      },
    });
    expect(s.model).toBe("deepseek-v4-pro");
    expect(s.status).toBe("done");
    expect(s.items.find((i) => i.kind === "user")).toMatchObject({ text: "make a counter" });
    expect(s.items.find((i) => i.kind === "assistant")).toMatchObject({ text: "Done.", reasoning: "planned it", streaming: false });
    expect(s.items.find((i) => i.id === "w1")).toMatchObject({ kind: "tool", status: "ok", summary: "Wrote /a.ts (1 line)." });
  });

  it("keeps a reasoning-only turn that ends in tool calls (no prose)", () => {
    const items = assistantItems([
      { type: "user_prompt", text: "go" },
      { type: "reasoning_delta", text: "I should write the file." },
      { type: "tool_call", id: "c1", name: "Write", input: { file_path: "/a.ts" } },
      { type: "assistant", text: "", reasoning: "I should write the file.", toolCalls: [{ id: "c1", name: "Write", input: { file_path: "/a.ts" } }] },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]!.text).toBe("");
    expect(items[0]!.reasoning).toBe("I should write the file.");
    expect(items[0]!.streaming).toBe(false);
  });
});
