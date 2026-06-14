/**
 * Command hooks — turn a settings.json `{ type:"command", command }` entry into a
 * PreToolUse/PostToolUse hook that shells out. The hook gets the event as JSON on
 * stdin and signals its decision via exit code / stdout JSON, matching the
 * reference clone's contract:
 *   - exit 2, or stdout {"decision":"block"} → deny
 *   - {"hookSpecificOutput":{"permissionDecision":"allow|deny|ask"}} → that decision
 *   - {"updatedInput": {...}} → allow with the rewritten input
 *   - anything else → continue (defer to the next gate)
 */

import { spawn } from "node:child_process";
import type { PostToolUseHook, PreToolUseDecision, PreToolUseHook } from "@zephyrcode/core";
import type { CommandHookSpec, HooksConfig } from "../settings";
import { matchesPattern } from "../settings";

interface ShellResult {
  code: number;
  stdout: string;
}

function runShell(command: string, stdin: string, timeoutMs: number): Promise<ShellResult> {
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, timeout: timeoutMs });
    let stdout = "";
    child.stdout?.on("data", (d) => (stdout += String(d)));
    child.on("error", () => resolve({ code: 0, stdout: "" })); // a broken hook command never breaks the run
    child.on("close", (code) => resolve({ code: code ?? 0, stdout }));
    child.stdin?.write(stdin);
    child.stdin?.end();
  });
}

function tryJson(text: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(text.trim());
    return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

const DEFAULT_TIMEOUT_MS = 120_000;

export function makeCommandPreToolUseHook(matcher: string | undefined, spec: CommandHookSpec): PreToolUseHook {
  return async ({ toolName, input }): Promise<PreToolUseDecision> => {
    if (!matchesPattern(toolName, matcher)) return { decision: "continue" };
    const payload = `${JSON.stringify({ hook_event_name: "PreToolUse", tool_name: toolName, tool_input: input })}\n`;
    const { code, stdout } = await runShell(spec.command, payload, spec.timeout ?? DEFAULT_TIMEOUT_MS);
    if (code === 2) return { decision: "deny", message: stdout.trim() || "Denied by a PreToolUse hook." };
    const parsed = tryJson(stdout);
    if (parsed) {
      if (parsed.decision === "block") return { decision: "deny", message: String(parsed.reason ?? "Blocked by a PreToolUse hook.") };
      const hso = parsed.hookSpecificOutput as { permissionDecision?: string; permissionDecisionReason?: string } | undefined;
      if (hso?.permissionDecision === "deny") return { decision: "deny", message: hso.permissionDecisionReason ?? "Denied by a PreToolUse hook." };
      if (hso?.permissionDecision === "ask") return { decision: "ask", reason: hso.permissionDecisionReason ?? "A PreToolUse hook requests confirmation." };
      if (hso?.permissionDecision === "allow") return { decision: "allow", updatedInput: parsed.updatedInput as Record<string, unknown> | undefined };
      if (parsed.updatedInput && typeof parsed.updatedInput === "object") {
        return { decision: "allow", updatedInput: parsed.updatedInput as Record<string, unknown> };
      }
    }
    return { decision: "continue" };
  };
}

export function makeCommandPostToolUseHook(matcher: string | undefined, spec: CommandHookSpec): PostToolUseHook {
  return async ({ toolName, input, result }) => {
    if (!matchesPattern(toolName, matcher)) return;
    const payload = `${JSON.stringify({ hook_event_name: "PostToolUse", tool_name: toolName, tool_input: input, tool_result: result.content })}\n`;
    await runShell(spec.command, payload, spec.timeout ?? DEFAULT_TIMEOUT_MS);
    // v1: post hooks run for side effects (format/lint/audit); they don't transform the result.
  };
}

/** Build the PreToolUse hooks declared in a HooksConfig. */
export function preToolUseHooksFrom(config: HooksConfig): PreToolUseHook[] {
  return (config.PreToolUse ?? []).flatMap((m) => m.hooks.map((h) => makeCommandPreToolUseHook(m.matcher, h)));
}

/** Build the PostToolUse hooks declared in a HooksConfig. */
export function postToolUseHooksFrom(config: HooksConfig): PostToolUseHook[] {
  return (config.PostToolUse ?? []).flatMap((m) => m.hooks.map((h) => makeCommandPostToolUseHook(m.matcher, h)));
}
