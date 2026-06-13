/**
 * POST /api/agent/run — runs the agent and streams the normalized event feed to
 * the client as Server-Sent Events. The response is hijacked so we can write the
 * raw SSE stream; the request closing aborts the run.
 */

import type { FastifyInstance } from "fastify";
import type { AgentEvent, RunAgentRequest } from "@coding-agent/shared";
import type { AgentRuntime } from "@coding-agent/core";

export function registerAgentRoutes(app: FastifyInstance, runtime: AgentRuntime): void {
  app.post("/api/agent/run", async (request, reply) => {
    const body = (request.body ?? {}) as Partial<RunAgentRequest>;
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) {
      reply.code(400);
      return { error: "prompt is required" };
    }

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
      "x-accel-buffering": "no",
    });

    const send = (event: AgentEvent): void => {
      raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // Abort the run only when the RESPONSE socket closes (client disconnected).
    // Listening on request.raw "close" is wrong: it fires as soon as the POST
    // body is fully received, which would abort the run immediately.
    const controller = new AbortController();
    raw.on("close", () => controller.abort());

    try {
      await runtime.run(
        { prompt, sessionId: body.sessionId, thinking: body.thinking === true },
        send,
        controller.signal,
      );
    } catch (err) {
      send({ type: "notice", level: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      raw.end();
    }
    return reply;
  });
}
