import { describe, expect, it } from "vitest";
import { applyEvent, initialState, isFinalItem, reduce, splitItems } from "../src/tui/state";
import type { Item } from "../src/tui/state";
import type { FileDiff, SessionState } from "@zephyrcode/shared";

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

  it("a context_report action appends a context panel item", () => {
    const report = {
      blocks: [
        { kind: "system" as const, tokens: 8000 },
        { kind: "tools" as const, tokens: 14000 },
        { kind: "rules" as const, tokens: 400 },
        { kind: "memory" as const, tokens: 800 },
        { kind: "history" as const, tokens: 23000 },
        { kind: "toolResults" as const, tokens: 25000 },
      ],
      estimatedTotal: 71200,
      contextTokens: 1_048_576,
      realUsedTokens: 72400,
      summarized: false,
    };
    const s = applyEvent(initialState(), { type: "context_report", report });
    expect(s.items.at(-1)).toMatchObject({ kind: "context", report });
  });

  it("an api_retry event surfaces a warn notice", () => {
    const s = applyEvent(initialState(), { type: "api_retry", attempt: 1, maxRetries: 8, delayMs: 500, status: 503 });
    expect(s.items.at(-1)).toMatchObject({ kind: "notice", level: "warn" });
  });

  it("attaches a file_change diff to the matching tool row by toolUseId", () => {
    const diff: FileDiff = {
      op: "edit",
      added: 1,
      removed: 1,
      truncated: false,
      hunks: [{ lines: [{ kind: "del", text: "old", oldLine: 1 }, { kind: "add", text: "new", newLine: 1 }] }],
    };
    let s = applyEvent(initialState(), { type: "tool_call", id: "t1", name: "Edit", input: { file_path: "/a.ts" } });
    s = applyEvent(s, { type: "file_change", op: "edit", path: "/a.ts", toolUseId: "t1", diff });
    const tool = s.items.find((i) => i.id === "t1");
    expect(tool).toMatchObject({ kind: "tool", diff: { added: 1, removed: 1 } });
  });

  it("ignores a file_change carrying no diff/toolUseId (legacy no-op)", () => {
    const s0 = applyEvent(initialState(), { type: "tool_call", id: "t1", name: "Edit", input: {} });
    const s1 = applyEvent(s0, { type: "file_change", op: "edit", path: "/a.ts" });
    expect(s1).toBe(s0); // unchanged reference — pure no-op
  });

  it("counts tool_args_delta toward the live gauge without rendering it", () => {
    let s = applyEvent(initialState(), { type: "user_prompt", text: "go" });
    s = applyEvent(s, { type: "tool_args_delta", text: "abcdef" });
    expect(s.turnChars).toBe(6); // counted (mirrors reasoning_delta)
    expect(s.items).toHaveLength(1); // only the user item — the JSON fragment is NOT rendered
  });

  it("hydrate renders a synthetic rehydration message as a chip, never the file body", () => {
    const session = {
      id: "s",
      createdAt: 0,
      updatedAt: 0,
      model: "m",
      title: "t",
      cwd: "/w",
      turns: 0,
      costUsd: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
      status: "idle",
      messages: [
        { role: "user", content: "real prompt" },
        { role: "summary", content: "…", boundary: { compactType: "manual", preTokens: 1 } },
        { role: "user", synthetic: "rehydrated_files", content: "[Restored file context after compaction]\n<file>SECRET BODY</file>" },
      ],
    } as SessionState;
    const s = applyEvent(initialState(), { type: "hydrate", session });
    // The file body must NOT appear as a user item (this was the leak).
    expect(s.items.some((i) => i.kind === "user" && i.text.includes("SECRET BODY"))).toBe(false);
    // It renders as a compact-style chip instead.
    expect(s.items.some((i) => i.kind === "compact" && i.reason.includes("restored file context"))).toBe(true);
    // The genuine user prompt still renders.
    expect(s.items.some((i) => i.kind === "user" && i.text === "real prompt")).toBe(true);
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

  it("carries a Bash command's risk into the pending permission", () => {
    const s = applyEvent(initialState(), {
      type: "permission_request",
      requestId: "r1",
      toolName: "Bash",
      input: { command: "rm -rf ~" },
      reason: "Confirm to proceed.",
      risk: { level: "destructive", category: "filesystem", reason: "recursive force-delete of a root/home/glob path" },
    });
    expect(s.permission?.risk).toMatchObject({ level: "destructive", category: "filesystem" });
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

  it("bumps epoch on reset and hydrate (so <Static> re-keys and the screen replaces)", () => {
    const start = initialState();
    expect(start.epoch).toBe(0);
    const afterReset = applyEvent(start, { type: "reset" });
    expect(afterReset.epoch).toBe(1);
    const afterHydrate = applyEvent(afterReset, {
      type: "hydrate",
      session: {
        id: "s", createdAt: 1, updatedAt: 1, model: "m", title: "t", cwd: "/", turns: 0, costUsd: 0,
        usage: { inputTokens: 0, outputTokens: 0 }, status: "done", messages: [{ role: "user", content: "hi" }],
      },
    });
    expect(afterHydrate.epoch).toBe(2);
  });

  it("does not cap committed items (the <Static> prefix must only grow within a session)", () => {
    let s = initialState();
    for (let i = 0; i < 250; i++) s = applyEvent(s, { type: "user_prompt", text: `p${i}` });
    // All 250 retained (no trimming) so <Static> never has to reprint a shifted prefix.
    expect(s.items.filter((i) => i.kind === "user")).toHaveLength(250);
  });
});

describe("splitItems (committed scrollback vs live tail)", () => {
  const user = (id: string): Item => ({ kind: "user", id, text: "u" });
  const doneAsst = (id: string): Item => ({ kind: "assistant", id, text: "a", streaming: false });
  const liveAsst = (id: string): Item => ({ kind: "assistant", id, text: "a", streaming: true });
  const runningTool = (id: string): Item => ({ kind: "tool", id, name: "Bash", status: "running", input: {} });
  const okTool = (id: string): Item => ({ kind: "tool", id, name: "Bash", status: "ok", input: {} });

  it("treats finished items as final and in-flight ones as live", () => {
    expect(isFinalItem(user("u"))).toBe(true);
    expect(isFinalItem(doneAsst("a"))).toBe(true);
    expect(isFinalItem(okTool("t"))).toBe(true);
    expect(isFinalItem(liveAsst("a"))).toBe(false);
    expect(isFinalItem(runningTool("t"))).toBe(false);
  });

  it("commits the longest final prefix; the rest is live", () => {
    const items = [user("u1"), doneAsst("a1"), liveAsst("a2")];
    const { committed, live } = splitItems(items);
    expect(committed.map((i) => i.id)).toEqual(["u1", "a1"]);
    expect(live.map((i) => i.id)).toEqual(["a2"]);
  });

  it("splits at the FIRST non-final item, keeping order even if a later item is final", () => {
    // running tool first, a finished tool after it → both stay live so order can't invert.
    const items = [user("u1"), runningTool("t1"), okTool("t2")];
    const { committed, live } = splitItems(items);
    expect(committed.map((i) => i.id)).toEqual(["u1"]);
    expect(live.map((i) => i.id)).toEqual(["t1", "t2"]);
  });

  it("commits everything when all items are final (idle)", () => {
    const items = [user("u1"), doneAsst("a1"), okTool("t1")];
    const { committed, live } = splitItems(items);
    expect(committed).toHaveLength(3);
    expect(live).toHaveLength(0);
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
