/**
 * createServer — the thin HTTP adapter. It owns no agent logic; it wires an
 * AgentRuntime to HTTP routes (SSE run, permission, sessions). Kept separate
 * from main.ts so tests can boot it with a stub runtime.
 */

import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { AgentRuntime } from "@coding-agent/core";
import { registerAgentRoutes } from "./routes/agent";
import { registerPermissionRoutes } from "./routes/permission";
import { registerSessionRoutes } from "./routes/sessions";

export interface CreateServerOptions {
  corsOrigin?: string | boolean;
}

export async function createServer(
  runtime: AgentRuntime,
  opts: CreateServerOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024 });
  await app.register(cors, { origin: opts.corsOrigin ?? true });

  app.get("/health", async () => ({ ok: true }));
  registerAgentRoutes(app, runtime);
  registerPermissionRoutes(app, runtime);
  registerSessionRoutes(app, runtime);

  return app;
}
