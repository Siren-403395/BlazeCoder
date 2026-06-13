/**
 * Bash — run a shell command in the working directory, behind the Sandbox port.
 * This is how the agent installs deps, builds, runs tests/linters/type-checks,
 * uses git, and does anything the dedicated file tools do not cover. It is also
 * how the agent VERIFIES its work. The Sandbox adapter decides the isolation
 * (an OS sandbox on macOS; approval-gated direct execution elsewhere); the tool
 * stays OS-agnostic.
 */

import type { Tool, ToolContext, ToolResult } from "../registry";
import { TOOL_NAMES } from "../toolNames";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;

export const runCommandTool: Tool = {
  name: TOOL_NAMES.bash,
  readOnly: false,
  description:
    "Run a shell command in the working directory and return its stdout/stderr and exit code. Use this for builds, tests, type-checks, linters, git, package managers, and scaffolding — and to VERIFY your work after editing. Prefer the dedicated tools (Read, Glob, Grep, Edit) over their shell equivalents (cat, find, grep, sed). Quote paths with spaces. Avoid commands that need interactive input.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "The shell command to run." },
      timeout_ms: { type: "number", description: `Max wall-clock time in ms (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}).` },
      description: { type: "string", description: "A 3-6 word description of what the command does." },
    },
    required: ["command"],
    additionalProperties: false,
  },
  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const command = typeof input.command === "string" ? input.command : undefined;
    if (!command) return { content: "Bash requires a 'command' string.", isError: true };
    if (!ctx.sandbox.available) {
      return {
        content:
          "Bash is unavailable: no command sandbox is configured for this run. (Wire a Sandbox adapter to enable shell execution.)",
        isError: true,
      };
    }
    const requested = typeof input.timeout_ms === "number" ? input.timeout_ms : DEFAULT_TIMEOUT_MS;
    const timeoutMs = Math.min(Math.max(1_000, requested), MAX_TIMEOUT_MS);

    const res = await ctx.sandbox.run(command, { cwd: ctx.workspace.root, timeoutMs, signal: ctx.signal });
    const body = [
      `exit code: ${res.exitCode}${res.timedOut ? " (timed out)" : ""}`,
      res.stdout ? `stdout:\n${res.stdout}` : "stdout: (empty)",
      res.stderr ? `stderr:\n${res.stderr}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return { content: body, isError: res.exitCode !== 0 };
  },
};
