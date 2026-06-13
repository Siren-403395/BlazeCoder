/**
 * Summarization-as-a-typed-contract (Mechanism B) + post-compaction rehydration.
 *
 * The summary is NOT free-form: it must capture user intent, key technical
 * concepts, files touched, errors + their fixes, pending tasks, and current
 * work — explicitly dropping verbatim tool outputs and intermediate reasoning.
 * After summarizing, durable context (the live project file list) is re-injected
 * automatically because project rules are re-assembled fresh every turn.
 */

import type { ModelRequest, TranscriptMessage } from "../ports";

export const SUMMARY_INSTRUCTIONS = [
  "You are compacting a coding-agent conversation to fit the context window.",
  "Produce a dense summary that preserves everything needed to continue the work, organized under these headings:",
  "1. User intent — what the user ultimately wants.",
  "2. Key technical decisions — framework, structure, conventions chosen.",
  "3. Files created/modified — paths and the load-bearing details of each.",
  "4. Errors encountered and how they were fixed.",
  "5. Pending tasks — what remains to be done.",
  "6. Current state — what was happening at the moment of compaction.",
  "Drop verbatim tool outputs and step-by-step reasoning. Be specific and concise.",
].join("\n");

/** Build the request used to summarize a slice of history. */
export function buildSummaryRequest(messagesToSummarize: TranscriptMessage[]): ModelRequest {
  const transcript = messagesToSummarize
    .map((m) => {
      switch (m.role) {
        case "user":
          return `USER: ${m.content}`;
        case "assistant":
          return `ASSISTANT: ${m.content}${
            m.toolCalls.length ? `\n[called: ${m.toolCalls.map((c) => c.name).join(", ")}]` : ""
          }`;
        case "tool":
          return `TOOL RESULTS: ${m.results.map((r) => `${r.toolName}${r.isError ? "(error)" : ""}`).join(", ")}`;
        case "summary":
          return `PRIOR SUMMARY:\n${m.content}`;
      }
    })
    .join("\n\n");

  return {
    system: SUMMARY_INSTRUCTIONS,
    messages: [{ role: "user", content: `Conversation to summarize:\n\n${transcript}` }],
    tools: [],
    maxOutputTokens: 1500,
    temperature: 0,
  };
}
