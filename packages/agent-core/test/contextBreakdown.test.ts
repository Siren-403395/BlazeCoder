import { describe, expect, it } from "vitest";
import type { TranscriptMessage } from "@zephyrcode/shared";
import { computeContextBreakdown } from "../src/index";

const tools = [
  { name: "Read", description: "read a file", inputSchema: { type: "object" } },
  { name: "Bash", description: "run a command", inputSchema: { type: "object" } },
];

function block(blocks: ReturnType<typeof computeContextBreakdown>, kind: string): number {
  return blocks.find((b) => b.kind === kind)!.tokens;
}

describe("computeContextBreakdown", () => {
  it("emits the six blocks in assembly order", () => {
    const blocks = computeContextBreakdown({ system: "x", projectRules: "y", messages: [], tools: [] });
    expect(blocks.map((b) => b.kind)).toEqual(["system", "tools", "rules", "memory", "history", "toolResults"]);
  });

  it("attributes tokens to system and tools, and zeroes empty blocks", () => {
    const blocks = computeContextBreakdown({
      system: "a system prompt of some length",
      projectRules: "",
      messages: [],
      tools,
    });
    expect(block(blocks, "system")).toBeGreaterThan(0);
    expect(block(blocks, "tools")).toBeGreaterThan(0);
    expect(block(blocks, "rules")).toBe(0);
    expect(block(blocks, "memory")).toBe(0);
    expect(block(blocks, "history")).toBe(0);
    expect(block(blocks, "toolResults")).toBe(0);
  });

  it("splits history (non-tool messages) from tool results", () => {
    const messages: TranscriptMessage[] = [
      { role: "user", content: "hello there, this is a user message" },
      { role: "assistant", content: "an assistant reply", reasoning: undefined, toolCalls: [] },
      {
        role: "tool",
        results: [{ toolUseId: "t1", toolName: "Read", content: "a".repeat(400), isError: false }],
      },
    ];
    const blocks = computeContextBreakdown({ system: "", projectRules: "", messages, tools: [] });
    expect(block(blocks, "history")).toBeGreaterThan(0);
    expect(block(blocks, "toolResults")).toBeGreaterThan(0);
    // The 400-char tool dump (counted at ~2 chars/token) outweighs the short prose history.
    expect(block(blocks, "toolResults")).toBeGreaterThan(block(blocks, "history"));
  });

  it("splits the memory index out of the project-rules block", () => {
    const memorySection = "recalled memory ".repeat(20);
    const projectRules = `# Environment\nWorking directory: /w\n## Memory\n${memorySection}`;
    const withMem = computeContextBreakdown({ system: "", projectRules, memorySection, messages: [], tools: [] });
    const withoutMem = computeContextBreakdown({ system: "", projectRules, messages: [], tools: [] });
    expect(block(withMem, "memory")).toBeGreaterThan(0);
    // With memory split out, the rules line is smaller than when memory is folded in.
    expect(block(withMem, "rules")).toBeLessThan(block(withoutMem, "rules"));
    // The whole rules+memory block is conserved across the split (within rounding).
    const folded = block(withoutMem, "rules") + block(withoutMem, "memory");
    const split = block(withMem, "rules") + block(withMem, "memory");
    expect(Math.abs(folded - split)).toBeLessThanOrEqual(2);
  });
});
