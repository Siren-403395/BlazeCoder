import type { PermissionDecisionRequest } from "@coding-agent/shared";

export async function postPermission(body: PermissionDecisionRequest): Promise<void> {
  await fetch("/api/agent/permission", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
