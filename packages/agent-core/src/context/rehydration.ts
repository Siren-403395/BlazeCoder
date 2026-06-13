/**
 * Summarization-as-a-typed-contract (Mechanism B) + post-compaction rehydration.
 *
 * The summary is NOT free-form: it must capture user intent, key technical
 * concepts, files touched, errors + their fixes, pending tasks, and current
 * work — explicitly dropping verbatim tool outputs and intermediate reasoning.
 * After summarizing, durable context (the live project file list) is re-injected
 * automatically because project rules are re-assembled fresh every turn.
 */

import type { ModelRequest, TranscriptMessage, Workspace } from "../ports";
import type { ReadLedger } from "../workspace/ledger";

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

/** Plain text of a kept message, for the "already present in the tail" check. */
function messageText(m: TranscriptMessage): string {
  switch (m.role) {
    case "user":
    case "summary":
      return m.content;
    case "assistant":
      return m.content;
    case "tool":
      return m.results.map((r) => r.content).join("\n");
  }
}

export interface PostCompactFileOptions {
  /** Max number of files to re-read. */
  limit?: number;
  /** Max chars kept per file (head-truncated beyond this). */
  perFileChars?: number;
  /** Max total chars across all restored files. */
  totalChars?: number;
}

/**
 * After summarizing, the model has only prose mentions of the files it was editing.
 * Re-read the most-recently-read files FRESH from the workspace and inject them as a
 * single synthetic user message right after the summary, so post-compaction turns
 * start on validated, current content. Files whose content is already present in the
 * kept tail are skipped (no point duplicating). Returns null if nothing to restore.
 */
export async function buildPostCompactFileMessage(
  ledger: ReadLedger,
  workspace: Workspace,
  keptTail: TranscriptMessage[],
  opts: PostCompactFileOptions = {},
): Promise<TranscriptMessage | null> {
  const limit = opts.limit ?? 5;
  const perFileChars = opts.perFileChars ?? 20_000;
  const totalChars = opts.totalChars ?? 200_000;
  const tailText = keptTail.map(messageText).join("\n");

  const blocks: string[] = [];
  let totalUsed = 0;
  // Oversample candidates since some will be skipped (binary, missing, already present).
  for (const abs of ledger.recentlyReadPaths(limit * 4)) {
    if (blocks.length >= limit) break;
    const file = await workspace.read(abs);
    if (!file || file.content.includes(String.fromCharCode(0))) continue;
    let content = file.content;
    if (content.length > perFileChars) content = `${content.slice(0, perFileChars)}\n…[truncated]`;
    // Skip if a representative slice is still present verbatim in the kept tail.
    const probe = content.slice(0, 200);
    if (probe.length > 0 && tailText.includes(probe)) continue;
    if (totalUsed + content.length > totalChars) break;
    totalUsed += content.length;
    blocks.push(`<file path="${abs}">\n${content}\n</file>`);
  }

  if (blocks.length === 0) return null;
  return {
    role: "user",
    content: `[Restored file context after compaction — current on-disk content of the files in play]\n${blocks.join("\n")}`,
  };
}
