import { describe, expect, it, vi } from "vitest";
import {
  ContextManager,
  createAgentRuntime,
  FixedClock,
  InMemoryMemoryStore,
  InMemorySessionStore,
  InMemoryWorkspace,
  silentLogger,
} from "../src/index";
import type { ModelGateway, ModelResponse, SessionState } from "../src/index";
import type { AgentEvent } from "@zephyrcode/shared";
import { reply, ScriptedGateway } from "./fakes";

const signal = new AbortController().signal;

describe("cache-token telemetry", () => {
  it("surfaces cache tokens on the budget event when the gateway reports them", async () => {
    const gateway: ModelGateway = {
      model: "m",
      async complete(): Promise<ModelResponse> {
        return { text: "done", toolCalls: [], stopReason: "end_turn", usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 80, cacheCreationTokens: 20 }, costUsd: 0 };
      },
    };
    const clock = new FixedClock(1);
    const rt = createAgentRuntime({ gateway, sessionStore: new InMemorySessionStore(clock), memory: new InMemoryMemoryStore(), workspace: new InMemoryWorkspace(), clock, logger: silentLogger });
    const events: AgentEvent[] = [];
    await rt.run({ prompt: "hi" }, (e) => events.push(e), signal);
    const budget = events.find((e): e is Extract<AgentEvent, { type: "budget" }> => e.type === "budget");
    expect(budget).toMatchObject({ cacheReadTokens: 80, cacheCreationTokens: 20 });
  });
});

describe("compaction logging + stable prefix", () => {
  it("logs compaction_done with before/after when it summarizes", async () => {
    const logger = { ...silentLogger, info: vi.fn() };
    const gw = new ScriptedGateway("m", [reply("SUMMARY")]);
    const cm = new ContextManager(
      { contextTokens: 60, outputReserveCap: 0, clearThreshold: 0.3, bufferTokens: 10, keepRecentToolResults: 5, keepRecentMessages: 1, maxThrash: 5 },
      new FixedClock(),
      logger,
      gw,
    );
    const s: SessionState = {
      id: "s", createdAt: 0, updatedAt: 0, model: "m", title: "t", cwd: "/", turns: 0, costUsd: 0, usage: { inputTokens: 0, outputTokens: 0 }, status: "running",
      messages: [
        { role: "user", content: "X".repeat(40) },
        { role: "assistant", content: "Y".repeat(40), toolCalls: [] },
        { role: "user", content: "Z".repeat(40) },
        { role: "assistant", content: "W".repeat(40), toolCalls: [] },
      ],
    };
    await cm.maybeCompact(s, { system: "", projectRules: "", tools: [] }, () => {}, signal);
    expect(logger.info).toHaveBeenCalledWith("compaction_done", expect.objectContaining({ stage: "summarize" }));
  });

  it("keeps the system prefix byte-identical across two turns of a session", async () => {
    const systems: string[] = [];
    const gateway: ModelGateway = {
      model: "m",
      async complete(req): Promise<ModelResponse> {
        systems.push(req.system);
        return reply("done", []);
      },
    };
    const clock = new FixedClock(1);
    const rt = createAgentRuntime({ gateway, sessionStore: new InMemorySessionStore(clock), memory: new InMemoryMemoryStore(), workspace: new InMemoryWorkspace(), clock, logger: silentLogger });
    const first = await rt.run({ prompt: "one" }, () => {}, signal);
    await rt.run({ prompt: "two", sessionId: first.session.id }, () => {}, signal);
    expect(systems).toHaveLength(2);
    expect(systems[0]).toBe(systems[1]); // stable, cacheable prefix
  });
});
