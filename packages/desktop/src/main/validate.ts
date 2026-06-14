/**
 * STRUCTURAL validation of every IPC payload before it reaches the AgentService — the
 * renderer is a separate process rendering untrusted model output, so the main process
 * never trusts a payload's shape. Pure (no Electron, no service reference): unit-tested
 * headless. SEMANTIC invariants (single-flight runs, permission-request liveness) live in
 * the service, which alone holds that state.
 */

import type { RuleSource } from "@zephyrcode/shared";
import { EFFORTS as EFFORT_LIST } from "../shared/ipc";
import type { DesktopRunRequest, Effort, PermissionDecisionRequest } from "../shared/ipc";

const EFFORTS = new Set<Effort>(EFFORT_LIST);
/** The persist scopes a human may choose from the GUI (RuleSource minus the in-memory cliArg). */
const PERSIST_SCOPES = new Set<RuleSource>(["session", "local", "project", "user"]);

export function isEffort(value: unknown): value is Effort {
  return typeof value === "string" && EFFORTS.has(value as Effort);
}

export function isPersistScope(value: unknown): value is RuleSource {
  return typeof value === "string" && PERSIST_SCOPES.has(value as RuleSource);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateCwd(value: unknown): string {
  if (!isNonEmptyString(value)) throw new Error("A project path is required.");
  return value;
}

export function validateSessionId(value: unknown): string {
  if (!isNonEmptyString(value)) throw new Error("A session id is required.");
  return value;
}

export function validateOptionalSessionId(value: unknown): string | undefined {
  return value === undefined ? undefined : validateSessionId(value);
}

export function validateRunRequest(value: unknown): DesktopRunRequest {
  if (typeof value !== "object" || value === null) throw new Error("Invalid run request.");
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.prompt)) throw new Error("Prompt is empty.");
  const out: DesktopRunRequest = { prompt: v.prompt };
  if (v.sessionId !== undefined) {
    if (!isNonEmptyString(v.sessionId)) throw new Error("Invalid session id.");
    out.sessionId = v.sessionId;
  }
  if (v.effort !== undefined) {
    if (!isEffort(v.effort)) throw new Error("Invalid effort.");
    out.effort = v.effort;
  }
  return out;
}

export function validatePermissionDecision(value: unknown): PermissionDecisionRequest {
  if (typeof value !== "object" || value === null) throw new Error("Invalid permission decision.");
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.requestId)) throw new Error("Invalid permission request id.");
  if (v.behavior !== "allow" && v.behavior !== "deny") throw new Error("Invalid permission behavior.");
  const out: PermissionDecisionRequest = { requestId: v.requestId, behavior: v.behavior };
  if (v.persist !== undefined) {
    if (!isPersistScope(v.persist)) throw new Error("Invalid persist scope.");
    out.persist = v.persist;
  }
  return out;
}

export function validateUrl(value: unknown): string {
  if (!isNonEmptyString(value)) throw new Error("A url is required.");
  return value;
}
