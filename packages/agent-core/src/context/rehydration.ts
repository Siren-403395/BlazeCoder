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
  "CRITICAL: Respond with TEXT ONLY. Do NOT call any tools — you already have all the needed context above; tool calls will be rejected and waste your only turn.",
  "",
  "You are compacting a zephyrcode conversation to fit the context window.",
  "First, think in an <analysis>...</analysis> block (it will be stripped): note what's been done, what's load-bearing, and what's left.",
  "Then produce a dense summary that preserves everything needed to continue the work, organized under these headings:",
  "1. User intent — what the user ultimately wants.",
  "2. All user messages — every non-tool user message, verbatim or near-verbatim, in order (so no request is lost).",
  "3. Key technical decisions — framework, structure, conventions chosen.",
  "4. Files created/modified — paths and the load-bearing details of each.",
  "5. Errors encountered and how they were fixed.",
  "6. Pending tasks — what remains to be done.",
  "7. Current state — what was happening at the moment of compaction.",
  "8. Next step — a DIRECT VERBATIM QUOTE of the task you were mid-way through, to avoid drift.",
  "Drop verbatim tool outputs and step-by-step reasoning. Be specific and concise.",
  "End by resuming directly; do not acknowledge this summary or recap it.",
].join("\n");

/** Strip the model's <analysis>…</analysis> scratchpad from a summary response. */
export function stripAnalysis(text: string): string {
  return text.replace(/<analysis>[\s\S]*?<\/analysis>/gi, "").trim();
}

/** The session-notes scaffold the model keeps fresh; used as a zero-cost summary when populated. */
export const NOTES_TEMPLATE = [
  "# Session notes",
  "## Session Title",
  "## Current State",
  "## Task Spec",
  "## Files & Functions",
  "## Errors & Corrections",
  "## Pending",
  "## Worklog",
].join("\n\n");

/** True if the notes hold real content (not just the empty template / whitespace). */
export function isSubstantialNotes(notes: string): boolean {
  const stripped = notes
    .split(/\r?\n/)
    .filter((l) => !/^#{1,6}\s/.test(l.trim()))
    .join("")
    .trim();
  return stripped.length >= 40;
}

/** Head-truncate each "## section" of the notes to perSectionChars, so notes can't blow the window. */
export function truncateNotes(notes: string, perSectionChars = 8000): string {
  const parts = notes.split(/\n(?=#{1,6}\s)/);
  return parts
    .map((part) => (part.length > perSectionChars ? `${part.slice(0, perSectionChars)}\n…[section truncated]` : part))
    .join("\n");
}

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
    // `synthetic` keeps this in the MODEL transcript but flags it so the TUI never replays
    // the full file bodies into visible scrollback on hydrate (see hydrateItems).
    synthetic: "rehydrated_files",
    content: `[Restored file context after compaction — current on-disk content of the files in play]\n${blocks.join("\n")}`,
  };
}
