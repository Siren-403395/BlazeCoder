/**
 * run_command — shell execution behind the Sandbox port. Disabled by default
 * (DisabledSandbox) because untrusted, model-issued shell commands require hard
 * isolation (container/VM, deny-read secrets, egress allowlist) that string
 * matching cannot provide. The tool exists as a first-class seam; wiring a real
 * sandbox adapter enables it without touching the loop.
 */

import type { Tool, ToolContext, ToolResult } from "../registry";

export const runCommandTool: Tool = {
  name: "run_command",
  readOnly: false,
  description:
    "Run a shell command inside the isolated sandbox and return its stdout/stderr. Use only when a task genuinely needs shell execution (e.g. running a build or test). Disabled unless a sandbox is configured.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "The shell command to run." },
      timeout_ms: { type: "number", description: "Max wall-clock time in ms (default 120000)." },
    },
    required: ["command"],
    additionalProperties: false,
  },
  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const command = typeof input.command === "string" ? input.command : undefined;
    if (!command) return { content: "run_command requires a 'command' string.", isError: true };
    if (!ctx.sandbox.available) {
      return {
        content:
          "run_command is disabled: no sandbox is configured. This deployment builds and previews projects without shell execution. (Wire a Sandbox adapter to enable it.)",
        isError: true,
      };
    }
    const timeoutMs = typeof input.timeout_ms === "number" ? input.timeout_ms : 120_000;
    const res = await ctx.sandbox.run(command, { timeoutMs, signal: ctx.signal });
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
