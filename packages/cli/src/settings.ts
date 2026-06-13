/**
 * settings.json hooks reader + the workspace-trust gate.
 *
 * Permission rules are loaded by agent-core's settingsStore; this reads the OTHER
 * half of the same files — the `hooks` section, which runs arbitrary shell. That
 * is an RCE vector if a cloned repo ships a malicious settings.json, so PROJECT-
 * scope hooks load ONLY for a trusted workspace (a trust marker under the project's
 * state dir). The user (home) scope is implicitly trusted; ZEPHYRCODE_DISABLE_HOOKS
 * is a global kill switch.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface CommandHookSpec {
  type: "command";
  command: string;
  timeout?: number;
}
export interface HookMatcher {
  matcher?: string;
  hooks: CommandHookSpec[];
}
export interface HooksConfig {
  PreToolUse?: HookMatcher[];
  PostToolUse?: HookMatcher[];
}

function asMatchers(value: unknown): HookMatcher[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: HookMatcher[] = [];
  for (const m of value) {
    if (!m || typeof m !== "object") continue;
    const rec = m as { matcher?: unknown; hooks?: unknown };
    if (!Array.isArray(rec.hooks)) continue;
    const hooks = rec.hooks
      .filter((h): h is { type: string; command: string; timeout?: number } => !!h && typeof (h as { command?: unknown }).command === "string")
      .map((h) => ({ type: "command" as const, command: h.command, timeout: typeof h.timeout === "number" ? h.timeout : undefined }));
    if (hooks.length === 0) continue;
    out.push({ matcher: typeof rec.matcher === "string" ? rec.matcher : undefined, hooks });
  }
  return out.length ? out : undefined;
}

/** Read + validate the `hooks` section of a settings file (missing/invalid → empty). */
export function readHooks(path: string): HooksConfig {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { hooks?: unknown };
    const h = parsed.hooks;
    if (!h || typeof h !== "object") return {};
    const rec = h as Record<string, unknown>;
    return { PreToolUse: asMatchers(rec.PreToolUse), PostToolUse: asMatchers(rec.PostToolUse) };
  } catch {
    return {};
  }
}

/**
 * Hook matcher grammar (ported): "*" or empty → all tools; "A|B" → alternation;
 * a string with regex metacharacters → anchored regex test; otherwise exact match.
 */
export function matchesPattern(toolName: string, matcher?: string): boolean {
  if (!matcher || matcher === "*") return true;
  if (matcher.includes("|")) return matcher.split("|").some((p) => matchesPattern(toolName, p.trim()));
  if (/[\^$.*+?()[\]{}\\]/.test(matcher)) {
    try {
      return new RegExp(matcher).test(toolName);
    } catch {
      return false;
    }
  }
  return matcher === toolName;
}

// ─── Workspace trust ────────────────────────────────────────────────────────

const TRUST_MARKER = "hooks-trusted";

/** Whether the user has trusted this workspace to run its project-scope command hooks. */
export function isWorkspaceTrusted(projectStateDir: string): boolean {
  return existsSync(join(projectStateDir, TRUST_MARKER));
}

/** Persist a trust decision for this workspace (under its per-project state dir). */
export function trustWorkspace(projectStateDir: string): void {
  mkdirSync(projectStateDir, { recursive: true });
  writeFileSync(join(projectStateDir, TRUST_MARKER), "1");
}

/** Global kill switch for all settings-driven hooks. */
export function hooksDisabled(): boolean {
  return process.env.ZEPHYRCODE_DISABLE_HOOKS === "1" || process.env.ZEPHYRCODE_DISABLE_HOOKS === "true";
}
