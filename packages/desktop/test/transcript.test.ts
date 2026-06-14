import { describe, expect, it } from "vitest";
import type { TranscriptMessage } from "@blazecoder/shared";
import { transcriptToTimeline } from "../src/renderer/app/transcript";
import type { AssistantItem, BoundaryItem, ToolItem } from "../src/renderer/app/types";

describe("transcriptToTimeline — session resume hydration", () => {
  it("maps a persisted transcript to timeline items (user, assistant+tools, results, summary)", () => {
    const messages: TranscriptMessage[] = [
      { role: "user", content: "do it" },
      { role: "assistant", content: "on it", reasoning: "plan", toolCalls: [{ id: "t1", name: "Read", input: { file_path: "a.ts" } }] },
      { role: "tool", results: [{ toolUseId: "t1", toolName: "Read", content: "file body", isError: false }] },
      { role: "summary", content: "summary text" },
    ];
    const items = transcriptToTimeline(messages);
    expect(items.find((i) => i.kind === "user")).toBeTruthy();
    const a = items.find((i) => i.kind === "assistant") as AssistantItem | undefined;
    expect(a?.reasoning).toBe("plan");
    expect(a?.complete).toBe(true);
    const t = items.find((i) => i.kind === "tool") as ToolItem | undefined;
    expect(t?.output).toBe("file body");
    expect(t?.toolUseId).toBe("t1");
    expect(items.some((i) => i.kind === "boundary")).toBe(true);
  });

  it("renders a synthetic rehydration message as a boundary, never a user bubble with the file bodies", () => {
    const messages: TranscriptMessage[] = [{ role: "user", content: "FULL FILE BODIES", synthetic: "rehydrated_files" }];
    const items = transcriptToTimeline(messages);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("boundary");
    expect((items[0] as BoundaryItem).text).not.toContain("FULL FILE BODIES");
  });

  it("tolerates a tool result whose tool_use was never seen (no crash, just skipped)", () => {
    const messages: TranscriptMessage[] = [
      { role: "tool", results: [{ toolUseId: "ghost", toolName: "Read", content: "x", isError: false }] },
    ];
    expect(transcriptToTimeline(messages)).toEqual([]);
  });
});
