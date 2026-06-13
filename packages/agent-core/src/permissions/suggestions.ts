/**
 * "Always allow" suggestions — when the engine asks the human, it offers concrete,
 * reusable rules so a single approval can cover a whole class of calls. Conservative
 * by design: a bare shell interpreter (bash/python/sudo/…) is suggested as an EXACT
 * rule, never a prefix, so approving `python x.py` can't silently allow `python evil.py`.
 */

import { TOOL_NAMES } from "../tools/toolNames";

/** Interpreters/shells where a prefix rule would be dangerously broad. */
const BARE_SHELL_PREFIXES = new Set([
  "bash", "sh", "zsh", "fish", "sudo", "env", "eval", "exec", "xargs",
  "python", "python3", "node", "deno", "bun", "ruby", "perl", "php",
]);

/** A reusable 2-word command prefix ('git commit -m "x"' → 'git commit'). */
export function simpleCommandPrefix(command: string): string {
  return command.trim().split(/\s+/).slice(0, 2).join(" ");
}

/**
 * Suggest "always allow" rule strings for a tool call. Returns rule strings (e.g.
 * "Bash(git commit:*)") that the UI wraps in a PermissionUpdate with the user's
 * chosen destination (local/project).
 */
export function getSuggestions(toolName: string, input: Record<string, unknown>): string[] {
  if (toolName === TOOL_NAMES.bash) {
    const command = typeof input.command === "string" ? input.command.trim() : "";
    if (!command) return [];
    const first = command.split(/\s+/)[0] ?? "";
    if (BARE_SHELL_PREFIXES.has(first)) return [`Bash(${command})`]; // exact — don't widen a dangerous interpreter
    return [`Bash(${simpleCommandPrefix(command)}:*)`];
  }
  if (toolName === TOOL_NAMES.read || toolName === TOOL_NAMES.write || toolName === TOOL_NAMES.edit) {
    const filePath = typeof input.file_path === "string" ? input.file_path : "";
    if (!filePath) return [];
    const dir = filePath.replace(/\/[^/]*$/, "") || "/";
    return [`${toolName}(${dir}/**)`];
  }
  return [toolName]; // whole-tool fallback
}
