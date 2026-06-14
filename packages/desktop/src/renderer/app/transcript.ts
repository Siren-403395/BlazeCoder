/**
 * Rebuild the timeline from a persisted session transcript (for session resume) — the
 * static counterpart to the live reducer, producing the SAME TimelineItem shapes the
 * reducer would for an equivalent event stream. Pure: types-only imports, unit-tested.
 */

import type { ToolCall, TranscriptMessage } from "@blazecoder/shared";
import type { TimelineItem, ToolItem } from "./types";

export function transcriptToTimeline(messages: TranscriptMessage[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const toolByUseId = new Map<string, number>(); // toolUseId -> index in items

  messages.forEach((message, index) => {
    if (message.role === "user") {
      // A synthetic rehydration message carries file bodies for the MODEL only — show a
      // boundary, never replay the (potentially huge) content as a user bubble.
      if (message.synthetic === "rehydrated_files") {
        items.push({ id: `h-restore-${index}`, kind: "boundary", text: "Restored file context after compaction" });
      } else {
        items.push({ id: `h-user-${index}`, kind: "user", text: message.content });
      }
    } else if (message.role === "assistant") {
      if (message.content || message.reasoning) {
        items.push({
          id: `h-assistant-${index}`,
          kind: "assistant",
          text: message.content,
          reasoning: message.reasoning ?? "",
          complete: true,
        });
      }
      message.toolCalls.forEach((call: ToolCall) => {
        toolByUseId.set(call.id, items.length);
        items.push({ id: `tool-${call.id}`, kind: "tool", toolUseId: call.id, name: call.name, input: call.input });
      });
    } else if (message.role === "tool") {
      message.results.forEach((result) => {
        const idx = toolByUseId.get(result.toolUseId);
        const existing = idx === undefined ? undefined : items[idx];
        if (idx !== undefined && existing && existing.kind === "tool") {
          const patched: ToolItem = { ...existing, output: result.content, isError: result.isError };
          items[idx] = patched;
        }
      });
    } else if (message.role === "summary") {
      items.push({ id: `h-summary-${index}`, kind: "boundary", text: "Compacted history summary" });
    }
  });

  return items;
}
