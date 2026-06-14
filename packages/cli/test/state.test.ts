import { describe, expect, it } from "vitest";
import { applyEvent, initialState, reduce } from "../src/tui/state";

describe("TUI state reducer", () => {
  it("records the prompt and enters running", () => {
    const s = applyEvent(initialState(), { type: "user_prompt", text: "build a counter" });
    expect(s.status).toBe("running");
    expect(s.items.at(-1)).toMatchObject({ kind: "user", text: "build a counter" });
  });

  it("a todos event fully replaces the live task list", () => {
    let s = applyEvent(initialState(), {
      type: "todos",
      items: [
        { content: "A", status: "completed", activeForm: "Aing" },
        { content: "B", status: "in_progress", activeForm: "Bing" },
      ],
    });
    expect(s.todos).toHaveLength(2);
    s = applyEvent(s, { type: "todos", items: [{ content: "C", status: "pending", activeForm: "Cing" }] });
    expect(s.todos.map((t) => t.content)).toEqual(["C"]); // replace, not append
  });

  it("an api_retry event surfaces a warn notice", () => {
    const s = applyEvent(initialState(), { type: "api_retry", attempt: 1, maxRetries: 8, delayMs: 500, status: 503 });
    expect(s.items.at(-1)).toMatchObject({ kind: "notice", level: "warn" });
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

  it("assembles a streamed turn into ONE assistant item and counts streamed chars", () => {
    const s = reduce([
      { type: "user_prompt", text: "go" },
      { type: "reasoning_delta", text: "Let me " },
      { type: "reasoning_delta", text: "plan." },
      { type: "assistant_delta", text: "Here" },
      { type: "assistant_delta", text: " it is." },
      { type: "assistant", text: "Here it is.", toolCalls: [] },
    ]);
    const items = s.items.filter((i) => i.kind === "assistant");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ text: "Here it is.", streaming: false });
    expect(items[0]).not.toHaveProperty("reasoning"); // thinking is not stored, only counted
    expect(s.turnChars).toBe(23); // 7 + 5 (reasoning) + 4 + 7 (prose) all counted
  });

  it("does not render a reasoning-only turn as a bubble, but still counts its tokens", () => {
    const s = reduce([
      { type: "user_prompt", text: "go" },
      { type: "reasoning_delta", text: "I should write the file." },
      { type: "tool_call", id: "c1", name: "Write", input: { file_path: "/a.ts" } },
      { type: "assistant", text: "", toolCalls: [{ id: "c1", name: "Write", input: { file_path: "/a.ts" } }] },
    ]);
    expect(s.items.filter((i) => i.kind === "assistant")).toHaveLength(0);
    expect(s.items.filter((i) => i.kind === "tool")).toHaveLength(1);
    expect(s.turnChars).toBe("I should write the file.".length);
  });

  it("resets the per-turn token estimate on a new prompt", () => {
    let s = reduce([{ type: "user_prompt", text: "go" }, { type: "reasoning_delta", text: "hmmm" }]);
    expect(s.turnChars).toBe(4);
    s = applyEvent(s, { type: "user_prompt", text: "again" });
    expect(s.turnChars).toBe(0);
  });

  it("tracks a tool from running to ok in place (no duplicate)", () => {
    const s = reduce([
      { type: "user_prompt", text: "go" },
      { type: "assistant", text: "", toolCalls: [{ id: "c1", name: "Write", input: { file_path: "/a.ts" } }] },
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

  it("reset clears the transcript but keeps model, effort, and output style", () => {
    const s = reduce([
      { type: "set_effort", effort: "ultra" },
      { type: "set_output_style", style: "concise" },
      { type: "system", subtype: "init", sessionId: "s", model: "m", tools: [], maxTurns: 24, contextTokens: 100 },
      { type: "user_prompt", text: "go" },
    ]);
    const cleared = applyEvent(s, { type: "reset" });
    expect(cleared.items).toHaveLength(0);
    expect(cleared.model).toBe("m");
    expect(cleared.effort).toBe("ultra");
    expect(cleared.outputStyle).toBe("concise"); // a runtime-level setting survives /clear
    expect(cleared.status).toBe("idle");
  });

  it("set_output_style sets and clears the active style", () => {
    let s = applyEvent(initialState(), { type: "set_output_style", style: "poet" });
    expect(s.outputStyle).toBe("poet");
    s = applyEvent(s, { type: "set_output_style", style: undefined });
    expect(s.outputStyle).toBeUndefined();
  });

  it("hydrates scrollback from a persisted session (resume), without rendering reasoning", () => {
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
    const assistant = s.items.find((i) => i.kind === "assistant");
    expect(assistant).toMatchObject({ text: "Done.", streaming: false });
    expect(assistant).not.toHaveProperty("reasoning");
    expect(s.items.find((i) => i.id === "w1")).toMatchObject({ kind: "tool", status: "ok", summary: "Wrote /a.ts (1 line)." });
  });
});
