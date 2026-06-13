/**
 * End-to-end: boot the real Fastify server with the deterministic stub model and
 * the REAL esbuild preview builder, drive it over HTTP, and assert the full SSE
 * event stream — including that esbuild actually bundled the generated app.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { AgentEvent } from "@coding-agent/shared";
import {
  createAgentRuntime,
  FixedClock,
  InMemoryMemoryStore,
  InMemorySessionStore,
  silentLogger,
} from "@coding-agent/core";
import type { FastifyInstance } from "fastify";
import { createServer } from "../src/server";
import { StubGateway } from "../src/adapters/stubGateway";
import { EsbuildPreviewBuilder } from "../src/adapters/esbuildPreviewBuilder";

let app: FastifyInstance;
let base = "";

beforeAll(async () => {
  const clock = new FixedClock(1);
  const runtime = createAgentRuntime({
    gateway: new StubGateway(),
    previewBuilder: new EsbuildPreviewBuilder(),
    sessionStore: new InMemorySessionStore(clock),
    memory: new InMemoryMemoryStore(),
    clock,
    logger: silentLogger,
  });
  app = await createServer(runtime);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await app.close();
});

async function readSse(res: Response): Promise<AgentEvent[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: AgentEvent[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (line) events.push(JSON.parse(line.slice(5).trim()) as AgentEvent);
    }
  }
  return events;
}

describe("server e2e (stub model + real esbuild)", () => {
  it("streams a full build over SSE and really compiles the app", async () => {
    const res = await fetch(`${base}/api/agent/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "build me a counter app" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const events = await readSse(res);
    expect(events[0]!.type).toBe("system");

    const fileChanges = events.filter((e) => e.type === "file_change");
    expect(fileChanges).toHaveLength(6);

    const preview = events.find((e) => e.type === "preview");
    expect(preview && preview.type === "preview" && preview.ok).toBe(true);
    if (preview && preview.type === "preview") {
      expect(preview.previewHtml).toContain("importmap");
      // The generated app's source must appear in the real esbuild bundle:
      expect(preview.previewHtml).toMatch(/count is/);
    }

    const last = events.at(-1)!;
    expect(last.type).toBe("result");
    expect(last.type === "result" && last.subtype).toBe("success");
  });

  it("serves /health and lists the created session", async () => {
    const health = (await (await fetch(`${base}/health`)).json()) as { ok: boolean };
    expect(health.ok).toBe(true);

    const { sessions } = (await (await fetch(`${base}/api/sessions`)).json()) as {
      sessions: { id: string }[];
    };
    expect(sessions.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects an empty prompt", async () => {
    const res = await fetch(`${base}/api/agent/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "" }),
    });
    expect(res.status).toBe(400);
  });
});
