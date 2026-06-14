/**
 * TodoWrite — a structured task list for the current session. The single
 * highest-leverage "missing tool": it makes multi-step work legible to the user
 * and keeps the model on-track. Stateless server-side (each call sends the FULL
 * list, which fully replaces the previous one); the live list is held by the UI
 * via the `todos` event. Description condensed (verbatim where load-bearing) from
 * the reference clone's ~180-line prompt.
 */

import type { TodoItem, TodoStatus } from "@blazecoder/shared";
import type { Tool, ToolContext, ToolResult } from "../registry";
import { TOOL_NAMES } from "../toolNames";

const STATUSES = new Set<TodoStatus>(["pending", "in_progress", "completed"]);

const DESCRIPTION = `Update the structured task list for the current session. Use this PROACTIVELY and often: it tracks progress, organizes complex work, and shows the user where things stand. Always send the COMPLETE list — it replaces the previous one.

## When to use
- A task needs 3+ distinct steps or actions.
- The work is non-trivial and benefits from planning.
- The user explicitly asks for a todo list, or gives multiple tasks (numbered/comma-separated).
- Right after receiving new instructions — capture the requirements as todos.
- Mark a task in_progress BEFORE starting it; mark it completed IMMEDIATELY when done.
- After finishing, add any follow-ups you discovered.

## When NOT to use
- A single, straightforward task.
- A trivial task (under ~3 steps) where tracking adds no value.
- Purely conversational or informational requests.

## Rules
- Each task has two forms: content (imperative, "Run the tests") and activeForm (present continuous, "Running the tests"). Both are required.
- Exactly ONE task is in_progress at a time — not zero, not two. Don't batch completions.
- Only mark a task completed when it is FULLY accomplished. If tests are failing, the implementation is partial, or you hit an error, keep it in_progress and add a new task for what remains.

## Example
User: "Add a dark-mode toggle, and run the tests and build when done."
→ todos: [build the toggle component] [wire up theme state] [add dark styles] [update components for theming] [run tests + build, fixing failures]. Begin the first task (status in_progress).`;

export const todoWriteTool: Tool = {
  name: TOOL_NAMES.todo,
  readOnly: false, // a control tool; the permission engine auto-allows it
  description: DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        description: "The complete task list (replaces the previous one).",
        items: {
          type: "object",
          properties: {
            content: { type: "string", minLength: 1, description: "Imperative form, e.g. 'Run the tests'." },
            status: { type: "string", enum: ["pending", "in_progress", "completed"] },
            activeForm: { type: "string", minLength: 1, description: "Present-continuous form, e.g. 'Running the tests'." },
          },
          required: ["content", "status", "activeForm"],
          additionalProperties: false,
        },
      },
    },
    required: ["todos"],
    additionalProperties: false,
  },
  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    if (!Array.isArray(input.todos)) return { content: "TodoWrite requires a 'todos' array.", isError: true };
    const items: TodoItem[] = [];
    for (const raw of input.todos as unknown[]) {
      const t = raw as Record<string, unknown>;
      const content = typeof t.content === "string" ? t.content.trim() : "";
      const activeForm = typeof t.activeForm === "string" ? t.activeForm.trim() : "";
      const status = t.status as TodoStatus;
      if (!content || !activeForm) return { content: "Each todo needs a non-empty 'content' and 'activeForm'.", isError: true };
      if (!STATUSES.has(status)) return { content: `Invalid todo status: ${String(t.status)}.`, isError: true };
      items.push({ content, status, activeForm });
    }
    if (items.filter((i) => i.status === "in_progress").length > 1) {
      return { content: "Only ONE task may be in_progress at a time.", isError: true };
    }

    ctx.emit({ type: "todos", items });

    if (items.length === 0) return { content: "Cleared the todo list." };
    const mark = (s: TodoStatus) => (s === "completed" ? "[x]" : s === "in_progress" ? "[~]" : "[ ]");
    const lines = items.map((i) => `  ${mark(i.status)} ${i.status === "in_progress" ? i.activeForm : i.content}`);
    const done = items.filter((i) => i.status === "completed").length;
    let content = `Todo list (${done}/${items.length} done):\n${lines.join("\n")}`;

    // Verification nudge: reinforce blazecoder's verify-before-done culture.
    const allDone = items.every((i) => i.status === "completed");
    if (allDone && items.length >= 3 && !items.some((i) => /verif|test|build|lint|typecheck/i.test(`${i.content} ${i.activeForm}`))) {
      content += "\n\nNOTE: You closed 3+ tasks with no verification step — run the build/tests before reporting the work done.";
    }
    return { content };
  },
};
