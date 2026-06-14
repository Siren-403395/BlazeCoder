/**
 * Passive auto-memory — the recall half of the memory system. Where the model-driven
 * `memory` tool WRITES durable facts to the sandboxed store, this reads the project's
 * memory INDEX (a single `MEMORY.md` file, kept small and high-signal) and surfaces it
 * into the agent's context every turn, so it recalls prior work WITHOUT having to spend
 * a tool call viewing /memories first. This mirrors Claude Code, where a MEMORY.md index
 * is loaded into context each session. Individual memory files are read on demand (via the
 * tool) — only the index is injected, which bounds the per-turn token cost.
 */

import type { MemoryStore } from "../ports";

/** The conventional location of the memory index inside the sandboxed store. */
export const MEMORY_INDEX_PATH = "/memories/MEMORY.md";

/** Hard cap on the injected index so a runaway file can't dominate the context window. */
const MAX_INDEX_CHARS = 4000;

/**
 * Read the project memory index and format it for injection as a project-rules section.
 * Returns "" when there is no index yet (the feature is a no-op until one exists), so the
 * caller can treat the result as an optional block.
 */
export async function loadMemoryIndex(memory: MemoryStore): Promise<string> {
  let raw: string | null;
  try {
    raw = await memory.read(MEMORY_INDEX_PATH);
  } catch {
    return "";
  }
  const body = (raw ?? "").trim();
  if (!body) return "";
  const clipped =
    body.length > MAX_INDEX_CHARS ? `${body.slice(0, MAX_INDEX_CHARS)}\n… (index truncated; view ${MEMORY_INDEX_PATH} for the rest)` : body;
  return `${clipped}\n\n(Recalled automatically from ${MEMORY_INDEX_PATH}. Use the memory tool's \`view\` to read any referenced file in full, and keep this index current as you learn durable facts.)`;
}
