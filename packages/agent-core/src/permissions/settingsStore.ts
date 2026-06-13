/**
 * Layered permission-settings files. Three editable scopes, lowest authority first:
 *   - user    `<home>/settings.json`                (global, all projects)
 *   - project `<cwd>/.zephyrcode/settings.json`       (committable, travels with the repo)
 *   - local   `<cwd>/.zephyrcode/settings.local.json` (gitignored, machine-specific)
 *
 * Settings live in the WORKING DIRECTORY, not in projectStateDir (where sessions and
 * memory live) — permission rules must travel with the repo, sessions must not. This
 * module is path-agnostic: the CLI composition root decides the three paths.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PermissionMode, PermissionRule, PermissionSettings, RuleBehavior, RuleSource } from "@coding-agent/shared";
import { ruleValueFromString } from "./rule";

const MODES = new Set<PermissionMode>(["default", "acceptEdits", "plan", "bypassPermissions"]);

/** Coerce arbitrary parsed JSON into a valid PermissionSettings (drops junk). */
function sanitize(parsed: unknown): PermissionSettings {
  if (!parsed || typeof parsed !== "object") return {};
  const perms = (parsed as { permissions?: unknown }).permissions;
  if (!perms || typeof perms !== "object") return {};
  const p = perms as Record<string, unknown>;
  const strArr = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;
  const mode = typeof p.defaultMode === "string" && MODES.has(p.defaultMode as PermissionMode) ? (p.defaultMode as PermissionMode) : undefined;
  return { permissions: { allow: strArr(p.allow), deny: strArr(p.deny), ask: strArr(p.ask), defaultMode: mode } };
}

/** Read + parse a settings file; a missing or malformed file yields empty settings. */
export function readSettings(path: string): PermissionSettings {
  try {
    return sanitize(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return {};
  }
}

/** Write settings as pretty JSON, creating the parent directory if needed. */
export function writeSettings(path: string, settings: PermissionSettings): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
}

/** Parse a settings file's rule strings into PermissionRules tagged with their source. */
export function rulesFromSettings(settings: PermissionSettings, source: RuleSource): PermissionRule[] {
  const p = settings.permissions ?? {};
  const mk = (arr: string[] | undefined, behavior: RuleBehavior): PermissionRule[] =>
    (arr ?? []).map((s) => ({ source, behavior, value: ruleValueFromString(s) }));
  // Deny first so it sorts ahead in the flat list (behavior-priority still re-checks).
  return [...mk(p.deny, "deny"), ...mk(p.allow, "allow"), ...mk(p.ask, "ask")];
}

export interface LoadedSettings {
  rules: PermissionRule[];
  /** Highest-authority defaultMode found (local > project > user), if any. */
  defaultMode?: PermissionMode;
}

/** Load + merge the three scopes in authority order (user → project → local). */
export function loadLayeredSettings(paths: { user: string; project: string; local: string }): LoadedSettings {
  const user = readSettings(paths.user);
  const project = readSettings(paths.project);
  const local = readSettings(paths.local);
  return {
    rules: [
      ...rulesFromSettings(user, "user"),
      ...rulesFromSettings(project, "project"),
      ...rulesFromSettings(local, "local"),
    ],
    defaultMode:
      local.permissions?.defaultMode ?? project.permissions?.defaultMode ?? user.permissions?.defaultMode,
  };
}
