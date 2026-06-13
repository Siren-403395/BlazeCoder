/**
 * POST /api/agent/permission — resolves a pending human-in-the-loop permission
 * request (the out-of-band half of the "ask" gate).
 */

import type { FastifyInstance } from "fastify";
import type { PermissionDecisionRequest } from "@coding-agent/shared";
import type { AgentRuntime } from "@coding-agent/core";

export function registerPermissionRoutes(app: FastifyInstance, runtime: AgentRuntime): void {
  app.post("/api/agent/permission", async (request, reply) => {
    const body = (request.body ?? {}) as Partial<PermissionDecisionRequest>;
    if (!body.requestId || (body.behavior !== "allow" && body.behavior !== "deny")) {
      reply.code(400);
      return { error: "requestId and behavior ('allow' | 'deny') are required" };
    }
    const ok = runtime.resolvePermission(body.requestId, {
      behavior: body.behavior,
      updatedInput: body.updatedInput,
      message: body.message,
    });
    return { ok };
  });
}
