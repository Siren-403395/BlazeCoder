/**
 * View model for the conversation stream. The reducer keeps a flat, ordered
 * trace; here we coalesce runs of consecutive tool entries into a single
 * "activity" group so the UI can render "the agent did N things" as one
 * progressively-disclosable block, while prose and notices stand alone.
 */

import type { TraceEntry } from "./agentState";

export type ConversationSegment =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string; reasoning?: string; streaming?: boolean }
  | { kind: "notice"; id: string; level: "info" | "warn" | "error"; text: string }
  | { kind: "compact"; id: string; text: string }
  | { kind: "activities"; id: string; items: TraceEntry[] };

export function buildConversation(trace: TraceEntry[]): ConversationSegment[] {
  const segments: ConversationSegment[] = [];
  let group: TraceEntry[] | null = null;

  const flush = () => {
    if (group && group.length > 0) {
      segments.push({ kind: "activities", id: `acts-${group[0]!.id}`, items: group });
    }
    group = null;
  };

  for (const entry of trace) {
    if (entry.kind === "tool") {
      (group ??= []).push(entry);
      continue;
    }
    flush();
    switch (entry.kind) {
      case "user":
        segments.push({ kind: "user", id: entry.id, text: entry.text });
        break;
      case "assistant":
        segments.push({
          kind: "assistant",
          id: entry.id,
          text: entry.text,
          reasoning: entry.reasoning,
          streaming: entry.streaming,
        });
        break;
      case "notice":
        segments.push({
          kind: "notice",
          id: entry.id,
          level: entry.level ?? "info",
          text: entry.text,
        });
        break;
      case "compact":
        segments.push({ kind: "compact", id: entry.id, text: entry.text });
        break;
    }
  }
  flush();
  return segments;
}
