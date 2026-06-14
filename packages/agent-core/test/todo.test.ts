import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@blazecoder/shared";
import { todoWriteTool } from "../src/index";
import { makeCtx } from "./fakes";

const t = (content: string, status: string, activeForm: string) => ({ content, status, activeForm });
const todosEvent = (events: AgentEvent[]) =>
  events.find((e): e is Extract<AgentEvent, { type: "todos" }> => e.type === "todos");

describe("TodoWrite tool", () => {
  it("emits a todos event with the full list and renders a summary", async () => {
    const { ctx, events } = makeCtx();
    const res = await todoWriteTool.execute(
      { todos: [t("Build it", "in_progress", "Building it"), t("Test it", "pending", "Testing it")] },
      ctx,
    );
    expect(res.isError).toBeFalsy();
    expect(todosEvent(events)?.items).toHaveLength(2);
    expect(res.content).toContain("[~] Building it"); // in_progress shows activeForm
    expect(res.content).toContain("[ ] Test it");
    expect(res.content).toContain("0/2 done");
  });

  it("rejects empty content/activeForm and bad status", async () => {
    const { ctx } = makeCtx();
    expect((await todoWriteTool.execute({ todos: [t("", "pending", "x")] }, ctx)).isError).toBe(true);
    expect((await todoWriteTool.execute({ todos: [t("x", "pending", "")] }, ctx)).isError).toBe(true);
    expect((await todoWriteTool.execute({ todos: [t("x", "bogus", "y")] }, ctx)).isError).toBe(true);
  });

  it("rejects more than one in_progress task", async () => {
    const { ctx } = makeCtx();
    const res = await todoWriteTool.execute(
      { todos: [t("A", "in_progress", "Aing"), t("B", "in_progress", "Bing")] },
      ctx,
    );
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/ONE task/i);
  });

  it("the latest call fully replaces the prior list (stateless: each event carries the full set)", async () => {
    const { ctx, events } = makeCtx();
    await todoWriteTool.execute({ todos: [t("A", "completed", "Aing"), t("B", "in_progress", "Bing")] }, ctx);
    await todoWriteTool.execute({ todos: [t("C", "pending", "Cing")] }, ctx);
    const all = events.filter((e): e is Extract<AgentEvent, { type: "todos" }> => e.type === "todos");
    expect(all).toHaveLength(2);
    expect(all[1]!.items.map((i) => i.content)).toEqual(["C"]); // second replaces first
  });

  it("nudges to verify when 3+ tasks are all done with no verification task", async () => {
    const { ctx } = makeCtx();
    const res = await todoWriteTool.execute(
      { todos: [t("a", "completed", "a"), t("b", "completed", "b"), t("c", "completed", "c")] },
      ctx,
    );
    expect(res.content).toMatch(/run the build\/tests/i);
  });

  it("does NOT nudge when a verification task is present", async () => {
    const { ctx } = makeCtx();
    const res = await todoWriteTool.execute(
      { todos: [t("a", "completed", "a"), t("b", "completed", "b"), t("run tests", "completed", "running tests")] },
      ctx,
    );
    expect(res.content).not.toMatch(/NOTE:/);
  });

  it("clears the list on an empty array", async () => {
    const { ctx, events } = makeCtx();
    const res = await todoWriteTool.execute({ todos: [] }, ctx);
    expect(res.content).toMatch(/Cleared/);
    expect(todosEvent(events)?.items).toEqual([]);
  });
});
