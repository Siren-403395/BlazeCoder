import type {
  PermissionDecisionRequest,
  SessionState,
  SessionSummary,
} from "@coding-agent/shared";

export async function postPermission(body: PermissionDecisionRequest): Promise<void> {
  await fetch("/api/agent/permission", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** List persisted sessions (most-recent first), for the history menu. */
export async function listSessions(): Promise<SessionSummary[]> {
  const res = await fetch("/api/sessions");
  if (!res.ok) throw new Error(`Failed to list sessions: HTTP ${res.status}`);
  return ((await res.json()) as { sessions: SessionSummary[] }).sessions;
}

/** Fetch a full session (transcript + project) to resume / rehydrate the UI. */
export async function getSession(id: string): Promise<SessionState> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to load session: HTTP ${res.status}`);
  return ((await res.json()) as { session: SessionState }).session;
}
