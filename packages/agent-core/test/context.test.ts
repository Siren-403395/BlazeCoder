import { describe, expect, it } from "vitest";
import {
  assembleRequest,
  CompactionThrashError,
  ContextManager,
  estimateTokens,
  FixedClock,
  silentLogger,
} from "../src/index";
import type { SessionState, TranscriptMessage } from "../src/index";
import { reply, ScriptedGateway } from "./fakes";

function session(messages: TranscriptMessage[]): SessionState {
  return {
    id: "s",
    createdAt: 0,
    updatedAt: 0,
    model: "m",
    title: "t",
    messages,
    cwd: "/work",
    turns: 0,
    costUsd: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    status: "running",
  };
}

const signal = new AbortController().signal;

describe("sessionContext", () => {
  it("estimateTokens ~ chars/4", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(40))).toBe(10);
  });

  it("injects the project rules block as the leading user message", () => {
    const req = assembleRequest({
      system: "SYS",
      projectRules: "RULES",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    });
    expect(req.system).toBe("SYS");
    expect(req.messages[0]).toEqual({ role: "user", content: "RULES" });
    expect(req.messages[1]).toEqual({ role: "user", content: "hi" });
  });

  it("omits the rules message when there are no rules", () => {
    const req = assembleRequest({
      system: "SYS",
      projectRules: "",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    });
    expect(req.messages).toEqual([{ role: "user", content: "hi" }]);
  });
});

describe("ContextManager compaction", () => {
  it("stage 1: clears old tool results without an LLM call", async () => {
    const cm = new ContextManager(
      { contextTokens: 100, clearThreshold: 0.5, compactThreshold: 0.95, keepRecentToolResults: 1, keepRecentMessages: 1, maxThrash: 5 },
      new FixedClock(),
      silentLogger,
    );
    const s = session([
      { role: "user", content: "hi" },
      { role: "tool", results: [{ toolUseId: "1", toolName: "x", content: "A".repeat(320), isError: false }] },
      { role: "tool", results: [{ toolUseId: "2", toolName: "y", content: "B".repeat(20), isError: false }] },
    ]);
    const events: string[] = [];
    await cm.maybeCompact(s, { system: "", projectRules: "", tools: [] }, (e) => events.push(e.type), signal);

    const firstTool = s.messages[1] as { results: { content: string }[] };
    const secondTool = s.messages[2] as { results: { content: string }[] };
    expect(firstTool.results[0]!.content).toMatch(/cleared/);
    expect(secondTool.results[0]!.content).toBe("B".repeat(20));
    expect(events).toContain("compact_boundary");
  });

  it("stage 2: summarizes history into a summary block", async () => {
    const gw = new ScriptedGateway("m", [reply("SUMMARY")]);
    const cm = new ContextManager(
      { contextTokens: 60, clearThreshold: 0.3, compactThreshold: 0.4, keepRecentToolResults: 5, keepRecentMessages: 1, maxThrash: 5 },
      new FixedClock(),
      silentLogger,
      gw,
    );
    const s = session([
      { role: "user", content: "X".repeat(40) },
      { role: "assistant", content: "Y".repeat(40), toolCalls: [] },
      { role: "user", content: "Z".repeat(40) },
      { role: "assistant", content: "W".repeat(40), toolCalls: [] },
    ]);
    await cm.maybeCompact(s, { system: "", projectRules: "", tools: [] }, () => {}, signal);
    expect(gw.calls).toBe(1);
    expect(s.messages[0]!.role).toBe("summary");
    expect((s.messages[0] as { content: string }).content).toBe("SUMMARY");
  });

  it("stage 3: throws CompactionThrashError when summarization stops helping", async () => {
    const huge = "S".repeat(420);
    const gw = new ScriptedGateway("m", [reply(huge)]);
    const cm = new ContextManager(
      { contextTokens: 50, clearThreshold: 0.3, compactThreshold: 0.4, keepRecentToolResults: 5, keepRecentMessages: 1, maxThrash: 1 },
      new FixedClock(),
      silentLogger,
      gw,
    );
    const s = session([
      { role: "user", content: "P".repeat(200) },
      { role: "assistant", content: "Q".repeat(200), toolCalls: [] },
      { role: "user", content: "R".repeat(200) },
    ]);
    await expect(cm.maybeCompact(s, { system: "", projectRules: "", tools: [] }, () => {}, signal)).rejects.toBeInstanceOf(
      CompactionThrashError,
    );
  });
});
