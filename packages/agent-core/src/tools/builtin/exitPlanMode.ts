/**
 * ExitPlanMode — the model's way OUT of plan mode. In `plan` permission mode every file
 * write and command is denied (read-only exploration only); this is the single control
 * action that lets the model present a plan and, on the user's approval, switch to a
 * working mode. The approval AND the actual mode switch are owned by the PermissionEngine
 * (which holds both the mode and the approval broker): this tool just carries the plan +
 * the command categories to pre-approve, and confirms once the engine has approved + switched.
 */

import type { Tool, ToolResult } from "../registry";
import { TOOL_NAMES } from "../toolNames";

export const exitPlanModeTool: Tool = {
  name: TOOL_NAMES.exitPlanMode,
  readOnly: false, // switching the permission mode is a state change, not a read
  description: `Present your implementation plan and request to leave plan mode and start executing. ONLY valid in plan mode — called in any other mode it is rejected.

Use it when you are in plan mode, have finished read-only investigation (Read/Grep/Glob), and are ready to act. The user approves or rejects the plan; on approval you switch to a working mode and may begin editing files / running commands.

- plan: the plan to show the user — concrete steps in markdown, no preamble.
- allowedCommands (optional): shell command prefixes the plan needs (e.g. "npm test", "pnpm build"), pre-approved as session allow-rules on exit so they run without re-prompting. Leave out anything risky — those will still ask.`,
  inputSchema: {
    type: "object",
    properties: {
      plan: { type: "string", description: "The implementation plan to show the user (markdown, concrete steps)." },
      allowedCommands: {
        type: "array",
        items: { type: "string" },
        description: 'Optional shell command prefixes the plan needs, pre-approved on exit (e.g. "npm test").',
      },
    },
    required: ["plan"],
    additionalProperties: false,
  },
  async execute(input): Promise<ToolResult> {
    // Reaches here only AFTER the engine approved the exit (plan mode + user OK) and already
    // switched the mode. Just acknowledge so the model continues into execution.
    const plan = typeof input.plan === "string" ? input.plan.trim() : "";
    return {
      content: plan
        ? "Plan approved — now in acceptEdits mode. Begin executing the plan."
        : "Exited plan mode — now in acceptEdits mode.",
    };
  },
};
