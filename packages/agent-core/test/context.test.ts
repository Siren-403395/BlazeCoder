import { describe, expect, it } from "vitest";
import {
  assembleRequest,
  CompactionThrashError,
  ContextManager,
  estimateMessageTokens,
  estimateRequestTokens,
  estimateTokens,
  FixedClock,
  InMemoryWorkspace,
  ReadLedger,
  silentLogger,
} from "../src/index";
import type { SessionState, TranscriptMessage } from "../src/index";
import type { AgentEvent } from "@coding-agent/shared";
import type { ModelGateway, ModelResponse } from "../src/index";
import { truncateHeadForSummary } from "../src/index";
import { reply, ScriptedGateway } from "./fakes";

/** A summarizer gateway that throws on the first `failTimes` calls, then returns text. */
class FlakySummarizer implements ModelGateway {
  readonly model = "m";
  calls = 0;
  constructor(private readonly failTimes: number, private readonly text = "SUMMARY") {}
  async complete(): Promise<ModelResponse> {
    this.calls += 1;
    if (this.calls <= this.failTimes) throw new Error("PROMPT_TOO_LONG");
    return reply(this.text);
  }
}

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
  it("estimateTokens ~ chars/4 by default, configurable density", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(40))).toBe(10);
    expect(estimateTokens("a".repeat(40), 2)).toBe(20); // JSON-dense density
  });

  it("counts JSON-dense tool-result content at ~2 chars/token, prose at ~4", () => {
    const prose = estimateMessageTokens({ role: "user", content: "a".repeat(1000) });
    const toolMsg = estimateMessageTokens({
      role: "tool",
      results: [{ toolUseId: "1", toolName: "Read", content: "a".repeat(1000), isError: false }],
    });
    expect(prose).toBe(250); // 1000/4
    expect(toolMsg).toBe(500); // 1000/2 — not under-counted
  });

  it("pads the request estimate by 4/3 to cover framing overhead", () => {
    const req = assembleRequest({ system: "", projectRules: "", messages: [{ role: "user", content: "a".repeat(120) }], tools: [] });
    // raw = 30 tokens; padded = ceil(30 * 4/3) = 40
    expect(estimateRequestTokens(req)).toBe(40);
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
      { contextTokens: 100, outputReservePad: 0, outputReserveCap: 0, clearThreshold: 0.5, bufferTokens: 5, keepRecentToolResults: 1, keepRecentMessages: 1, maxThrash: 5 },
      new FixedClock(),
      silentLogger,
    );
    const s = session([
      { role: "user", content: "hi" },
      { role: "tool", results: [{ toolUseId: "1", toolName: "Read", content: "A".repeat(320), isError: false }] },
      { role: "tool", results: [{ toolUseId: "2", toolName: "Read", content: "B".repeat(20), isError: false }] },
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
      { contextTokens: 60, outputReservePad: 0, outputReserveCap: 0, clearThreshold: 0.3, bufferTokens: 10, keepRecentToolResults: 5, keepRecentMessages: 1, maxThrash: 5 },
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
      { contextTokens: 50, outputReservePad: 0, outputReserveCap: 0, clearThreshold: 0.3, bufferTokens: 10, keepRecentToolResults: 5, keepRecentMessages: 1, maxThrash: 1 },
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

  it("clears only whitelisted (Read/Bash/Grep/Glob) old results, keeps Edit/Write + the most recent", async () => {
    const cm = new ContextManager(
      { contextTokens: 100, outputReservePad: 0, outputReserveCap: 0, clearThreshold: 0.2, bufferTokens: 1, keepRecentToolResults: 1, keepRecentMessages: 1, maxThrash: 5 },
      new FixedClock(),
      silentLogger,
    );
    const s = session([
      { role: "user", content: "hi" },
      { role: "tool", results: [{ toolUseId: "r1", toolName: "Read", content: "A".repeat(400), isError: false }] },
      { role: "tool", results: [{ toolUseId: "e1", toolName: "Edit", content: "Edited /a.ts (1 replacement).", isError: false }] },
      { role: "tool", results: [{ toolUseId: "r2", toolName: "Read", content: "B".repeat(40), isError: false }] },
    ]);
    const events: AgentEvent[] = [];
    await cm.maybeCompact(s, { system: "", projectRules: "", tools: [] }, (e) => events.push(e), signal);

    const tool = (i: number) => s.messages[i] as Extract<TranscriptMessage, { role: "tool" }>;
    expect(tool(1).results[0]!.content).toMatch(/Read result cleared/); // old Read cleared
    expect(tool(2).results[0]!.content).toBe("Edited /a.ts (1 replacement)."); // Edit kept verbatim
    expect(tool(3).results[0]!.content).toBe("B".repeat(40)); // most-recent kept verbatim
    const boundary = events.find((e): e is Extract<AgentEvent, { type: "compact_boundary" }> => e.type === "compact_boundary");
    expect(boundary?.clearedToolUseIds).toEqual(["r1"]);
  });

  it("after summarization inserts a restored-files message and clears the ledger", async () => {
    const ws = new InMemoryWorkspace();
    await ws.write({ path: "/main.ts", language: "ts", content: "export const x = 1;\n".repeat(8) });
    const led = new ReadLedger();
    led.record("/main.ts", (await ws.stat("/main.ts"))!);
    const gw = new ScriptedGateway("m", [reply("SUMMARY")]);
    const cm = new ContextManager(
      { contextTokens: 60, outputReservePad: 0, outputReserveCap: 0, clearThreshold: 0.1, bufferTokens: 55, keepRecentToolResults: 1, keepRecentMessages: 1, maxThrash: 5 },
      new FixedClock(),
      silentLogger,
      gw,
    );
    const s = session([
      { role: "user", content: "X".repeat(40) },
      { role: "tool", results: [{ toolUseId: "t1", toolName: "Read", content: "R".repeat(200), isError: false }] },
      { role: "tool", results: [{ toolUseId: "t2", toolName: "Read", content: "S".repeat(40), isError: false }] },
      { role: "user", content: "Z".repeat(40) },
    ]);
    await cm.maybeCompact(s, { system: "", projectRules: "", tools: [], ledger: led, workspace: ws }, () => {}, signal);

    expect(s.messages[0]!.role).toBe("summary");
    expect(s.messages[1]!.role).toBe("user");
    expect((s.messages[1] as { content: string }).content).toContain("Restored file context after compaction");
    expect((s.messages[1] as { content: string }).content).toContain("/main.ts");
    expect(led.recentlyReadPaths()).toEqual([]); // ledger cleared post-rehydration
  });

  it("fires onPreCompact once when compacting, and not when under threshold", async () => {
    const cm = new ContextManager(
      { contextTokens: 100, outputReservePad: 0, outputReserveCap: 0, clearThreshold: 0.5, bufferTokens: 5, keepRecentToolResults: 1, keepRecentMessages: 1, maxThrash: 5 },
      new FixedClock(),
      silentLogger,
    );
    let fired = 0;
    const onPreCompact = () => {
      fired += 1;
    };
    const big = session([
      { role: "user", content: "hi" },
      { role: "tool", results: [{ toolUseId: "1", toolName: "Read", content: "A".repeat(400), isError: false }] },
      { role: "tool", results: [{ toolUseId: "2", toolName: "Read", content: "B".repeat(40), isError: false }] },
    ]);
    await cm.maybeCompact(big, { system: "", projectRules: "", tools: [], onPreCompact }, () => {}, signal);
    expect(fired).toBe(1);

    // A small session stays under the clear threshold → no compaction, no hook.
    await cm.maybeCompact(session([{ role: "user", content: "hi" }]), { system: "", projectRules: "", tools: [], onPreCompact }, () => {}, signal);
    expect(fired).toBe(1);
  });

  it("keeps an assistant tool_use with its tool_result across the split, and marks the boundary", async () => {
    const gw = new ScriptedGateway("m", [reply("SUMMARY")]);
    const cm = new ContextManager(
      {
        contextTokens: 100,
        outputReservePad: 0,
        outputReserveCap: 0,
        clearThreshold: 0.1,
        bufferTokens: 95,
        keepRecentToolResults: 1,
        keepRecentMessages: 1,
        maxThrash: 5,
        // Token-floored window: keep just enough that the split lands ON the tool
        // message, so adjustSplit must move back to include its assistant tool_use.
        summaryKeepMinTokens: 1,
        summaryKeepMinMessages: 0,
        summaryKeepMaxTokens: 10_000,
      },
      new FixedClock(),
      silentLogger,
      gw,
    );
    const s = session([
      { role: "user", content: "OLD".repeat(40) },
      { role: "user", content: "the prompt" },
      { role: "assistant", content: "", toolCalls: [{ id: "a1", name: "Read", input: {} }] },
      { role: "tool", results: [{ toolUseId: "a1", toolName: "Read", content: "BIG".repeat(200), isError: false }] },
    ]);
    await cm.maybeCompact(s, { system: "", projectRules: "", tools: [] }, () => {}, signal);

    expect(s.messages[0]!.role).toBe("summary");
    // The kept tail starts with the ASSISTANT tool_use, NOT an orphaned tool_result.
    expect(s.messages[1]!.role).toBe("assistant");
    expect(s.messages[2]!.role).toBe("tool");
    const summary = s.messages[0] as Extract<TranscriptMessage, { role: "summary" }>;
    expect(summary.boundary).toMatchObject({ compactType: "auto" });
    expect(typeof summary.boundary?.preTokens).toBe("number");
  });

  it("truncateHeadForSummary drops the oldest round (before the 2nd assistant)", () => {
    const head: TranscriptMessage[] = [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1", toolCalls: [] },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2", toolCalls: [] },
      { role: "user", content: "u3" },
    ];
    const out = truncateHeadForSummary(head);
    expect(out.map((m) => (m.role === "assistant" ? m.content : (m as { content: string }).content))).toEqual(["a2", "u3"]);
    // Fewer than 2 rounds → returned unchanged (can't shrink).
    expect(truncateHeadForSummary([{ role: "user", content: "x" }]).length).toBe(1);
  });

  function summarizableSession() {
    return session([
      { role: "user", content: "X".repeat(40) },
      { role: "assistant", content: "Y".repeat(40), toolCalls: [] },
      { role: "user", content: "Z".repeat(40) },
      { role: "assistant", content: "W".repeat(40), toolCalls: [] },
    ]);
  }
  const failCfg = { contextTokens: 60, outputReservePad: 0, outputReserveCap: 0, clearThreshold: 0.3, bufferTokens: 10, keepRecentToolResults: 5, keepRecentMessages: 1, maxThrash: 5 } as const;

  it("a summarize that throws increments the failure counter and emits a notice (no throw)", async () => {
    const cm = new ContextManager(failCfg, new FixedClock(), silentLogger, new FlakySummarizer(99));
    const events: AgentEvent[] = [];
    await cm.maybeCompact(summarizableSession(), { system: "", projectRules: "", tools: [] }, (e) => events.push(e), signal);
    expect(events.some((e) => e.type === "notice" && /Summarization failed \(1\/3\)/.test((e as { message: string }).message))).toBe(true);
  });

  it("short-circuits with a /clear notice after 3 consecutive failures", async () => {
    const cm = new ContextManager(failCfg, new FixedClock(), silentLogger, new FlakySummarizer(99));
    for (let i = 0; i < 3; i++) await cm.maybeCompact(summarizableSession(), { system: "", projectRules: "", tools: [] }, () => {}, signal);
    const events: AgentEvent[] = [];
    await cm.maybeCompact(summarizableSession(), { system: "", projectRules: "", tools: [] }, (e) => events.push(e), signal);
    expect(events.some((e) => e.type === "notice" && /Use \/clear/.test((e as { message: string }).message))).toBe(true);
  });

  it("a summarizer that fails twice then succeeds completes compaction", async () => {
    const gw = new FlakySummarizer(2);
    const cm = new ContextManager(failCfg, new FixedClock(), silentLogger, gw);
    // keepRecentMessages:1 → the head holds 3 assistant "rounds", so it can shrink
    // twice (full → from 2nd assistant → from 3rd) before the 3rd attempt succeeds.
    const s = session([
      { role: "user", content: "A".repeat(40) },
      { role: "assistant", content: "B".repeat(40), toolCalls: [] },
      { role: "user", content: "C".repeat(40) },
      { role: "assistant", content: "D".repeat(40), toolCalls: [] },
      { role: "user", content: "E".repeat(40) },
      { role: "assistant", content: "F".repeat(40), toolCalls: [] },
      { role: "user", content: "G".repeat(40) },
    ]);
    await cm.maybeCompact(s, { system: "", projectRules: "", tools: [] }, () => {}, signal);
    expect(gw.calls).toBe(3); // two overflows + one success
    expect(s.messages[0]!.role).toBe("summary");
  });

  it("compactNow forces summarization regardless of thresholds", async () => {
    const gw = new ScriptedGateway("m", [reply("FORCED SUMMARY")]);
    const cm = new ContextManager(
      { contextTokens: 1_000_000, outputReservePad: 0, outputReserveCap: 0, clearThreshold: 0.9, bufferTokens: 1, keepRecentToolResults: 1, keepRecentMessages: 1, maxThrash: 5 },
      new FixedClock(),
      silentLogger,
      gw,
    );
    const s = session([
      { role: "user", content: "X" },
      { role: "assistant", content: "Y", toolCalls: [] },
      { role: "user", content: "Z" },
    ]);
    // Well under any threshold — maybeCompact would do nothing, but compactNow forces it.
    await cm.compactNow(s, { system: "", projectRules: "", tools: [] }, () => {}, signal);
    expect(s.messages[0]!.role).toBe("summary");
  });

  it("prefers the authoritative real input-token count over the char-heuristic", async () => {
    const cm = new ContextManager(
      { contextTokens: 100, outputReservePad: 0, outputReserveCap: 0, clearThreshold: 0.5, bufferTokens: 5, keepRecentToolResults: 1, keepRecentMessages: 1, maxThrash: 5 },
      new FixedClock(),
      silentLogger,
    );
    const s = session([
      { role: "user", content: "hi" },
      { role: "tool", results: [{ toolUseId: "1", toolName: "Read", content: "A".repeat(4000), isError: false }] },
    ]);
    const snapshot = JSON.stringify(s.messages);
    const events: string[] = [];
    // The char-heuristic (~2000 tokens) would blow past clearAt(50) and clear the
    // tool result; but the server's real count is tiny, so nothing should compact.
    await cm.maybeCompact(s, { system: "", projectRules: "", tools: [], realInputTokens: 5 }, (e) => events.push(e.type), signal);
    expect(JSON.stringify(s.messages)).toBe(snapshot);
    expect(events).not.toContain("compact_boundary");
  });
});
