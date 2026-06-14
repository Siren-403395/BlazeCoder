import { describe, expect, it } from "vitest";
import { ContextManager, FixedClock, isSubstantialNotes, NOTES_TEMPLATE, silentLogger, truncateNotes } from "../src/index";
import type { SessionState } from "../src/index";
import { reply, ScriptedGateway } from "./fakes";

const signal = new AbortController().signal;
const cfg = { contextTokens: 60, outputReserveCap: 0, clearThreshold: 0.3, bufferTokens: 10, keepRecentToolResults: 5, keepRecentMessages: 1, maxThrash: 5 } as const;

function session(): SessionState {
  return {
    id: "s", createdAt: 0, updatedAt: 0, model: "m", title: "t", cwd: "/", turns: 0, costUsd: 0, usage: { inputTokens: 0, outputTokens: 0 }, status: "running",
    messages: [
      { role: "user", content: "X".repeat(40) },
      { role: "assistant", content: "Y".repeat(40), toolCalls: [] },
      { role: "user", content: "Z".repeat(40) },
      { role: "assistant", content: "W".repeat(40), toolCalls: [] },
    ],
  };
}

describe("session notes helpers", () => {
  it("isSubstantialNotes is false for the empty template, true once filled", () => {
    expect(isSubstantialNotes(NOTES_TEMPLATE)).toBe(false);
    expect(isSubstantialNotes(`${NOTES_TEMPLATE}\nWe migrated the auth flow and fixed the token refresh bug.`)).toBe(true);
  });

  it("truncateNotes caps each section", () => {
    const notes = `## A\n${"x".repeat(20)}\n## B\n${"y".repeat(20)}`;
    const out = truncateNotes(notes, 10);
    expect(out).toMatch(/section truncated/);
  });
});

describe("notes as a zero-cost summary source", () => {
  it("uses substantial notes verbatim WITHOUT calling the gateway", async () => {
    const gw = new ScriptedGateway("m", [reply("SHOULD-NOT-BE-USED")]);
    const cm = new ContextManager(cfg, new FixedClock(), silentLogger, gw);
    const s = session();
    const notes = `${NOTES_TEMPLATE}\n## Current State\nWe are wiring the compaction notes path; tail must be preserved.`;
    await cm.maybeCompact(s, { system: "", projectRules: "", tools: [], notes }, () => {}, signal);

    expect(gw.calls).toBe(0); // no summarizer call
    expect(s.messages[0]!.role).toBe("summary");
    expect((s.messages[0] as { content: string }).content).toContain("compaction notes path");
  });

  it("falls back to the gateway summarizer when notes are empty/template", async () => {
    const gw = new ScriptedGateway("m", [reply("LLM SUMMARY")]);
    const cm = new ContextManager(cfg, new FixedClock(), silentLogger, gw);
    const s = session();
    await cm.maybeCompact(s, { system: "", projectRules: "", tools: [], notes: NOTES_TEMPLATE }, () => {}, signal);
    expect(gw.calls).toBe(1);
    expect((s.messages[0] as { content: string }).content).toBe("LLM SUMMARY");
  });
});
