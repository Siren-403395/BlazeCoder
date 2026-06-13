import { describe, expect, it } from "vitest";
import { buildConversation } from "@/lib/conversation";
import type { TraceEntry } from "@/lib/agentState";

function entry(partial: Partial<TraceEntry> & { id: string; kind: TraceEntry["kind"] }): TraceEntry {
  return { text: "", ...partial };
}

describe("buildConversation", () => {
  it("coalesces consecutive tool entries into one activity group", () => {
    const trace: TraceEntry[] = [
      entry({ id: "1", kind: "user", text: "build it" }),
      entry({ id: "2", kind: "assistant", text: "ok" }),
      entry({ id: "3", kind: "tool", toolName: "write_file" }),
      entry({ id: "4", kind: "tool", toolName: "edit_file" }),
      entry({ id: "5", kind: "assistant", text: "done" }),
      entry({ id: "6", kind: "notice", level: "warn", text: "heads up" }),
      entry({ id: "7", kind: "compact", text: "compacted" }),
      entry({ id: "8", kind: "tool", toolName: "build_preview" }),
    ];

    const segs = buildConversation(trace);
    expect(segs.map((s) => s.kind)).toEqual([
      "user",
      "assistant",
      "activities",
      "assistant",
      "notice",
      "compact",
      "activities",
    ]);

    const firstGroup = segs[2];
    expect(firstGroup?.kind === "activities" && firstGroup.items.length).toBe(2);
    const lastGroup = segs[6];
    expect(lastGroup?.kind === "activities" && lastGroup.items.length).toBe(1);
  });

  it("returns an empty list for an empty trace", () => {
    expect(buildConversation([])).toEqual([]);
  });
});
