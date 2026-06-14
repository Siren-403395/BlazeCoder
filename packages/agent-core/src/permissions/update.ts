/**
 * PermissionUpdate pipeline — apply a change to an in-memory settings object and
 * persist it to the right scope's file. "always allow / always deny" decisions
 * and plan-mode exits flow through here. Rule strings are normalized via the
 * parse→serialize round-trip so `Bash(git:*)`, `Bash(git:*)` and duplicates collapse.
 */

import type { PermissionMode, PermissionSettings, RuleBehavior, RuleSource } from "@blazecoder/shared";
import { readSettings, writeSettings } from "./settingsStore";
import { ruleValueFromString, ruleValueToString } from "./rule";

export type PermissionUpdate =
  | { type: "addRules"; behavior: RuleBehavior; rules: string[]; destination: RuleSource }
  | { type: "removeRules"; behavior: RuleBehavior; rules: string[]; destination: RuleSource }
  | { type: "setMode"; mode: PermissionMode; destination: RuleSource };

/** Sources that have a backing file. session/cliArg are in-memory only. */
export function supportsPersistence(destination: RuleSource): destination is "user" | "project" | "local" {
  return destination === "user" || destination === "project" || destination === "local";
}

const KEY: Record<RuleBehavior, "allow" | "deny" | "ask"> = { allow: "allow", deny: "deny", ask: "ask" };

/** Normalize a rule string (round-trip through the parser) for dedup/removal. */
function normalize(rule: string): string {
  return ruleValueToString(ruleValueFromString(rule));
}

/** Apply an update to a settings object, returning a new object (does not write to disk). */
export function applyUpdate(settings: PermissionSettings, update: PermissionUpdate): PermissionSettings {
  const next: PermissionSettings = { permissions: { ...(settings.permissions ?? {}) } };
  const perms = next.permissions!;
  if (update.type === "setMode") {
    perms.defaultMode = update.mode;
    return next;
  }
  const key = KEY[update.behavior];
  const existing = (perms[key] ?? []).map(normalize);
  const incoming = update.rules.map(normalize);
  if (update.type === "addRules") {
    perms[key] = [...new Set([...existing, ...incoming])];
  } else {
    const drop = new Set(incoming);
    perms[key] = existing.filter((r) => !drop.has(r));
  }
  return next;
}

/**
 * Persist an update to its destination file (no-op for non-persistent destinations).
 * Returns true if a file was written.
 */
export function persistPermissionUpdate(path: string, update: PermissionUpdate): boolean {
  if (!supportsPersistence(update.destination)) return false;
  writeSettings(path, applyUpdate(readSettings(path), update));
  return true;
}
