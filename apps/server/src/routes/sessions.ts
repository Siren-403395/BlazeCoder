/**
 * Session read endpoints: list sessions and fetch one (with its project + transcript).
 */

import type { FastifyInstance } from "fastify";
import type { AgentRuntime } from "@coding-agent/core";

export function registerSessionRoutes(app: FastifyInstance, runtime: AgentRuntime): void {
  app.get("/api/sessions", async () => ({ sessions: await runtime.listSessions() }));

  app.get("/api/sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await runtime.getSession(id);
    if (!session) {
      reply.code(404);
      return { error: "session not found" };
    }
    return { session };
  });
}
