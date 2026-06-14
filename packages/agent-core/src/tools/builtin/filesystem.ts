/**
 * File tools at Claude-Code parity, over the real Workspace: Read, Write, Edit.
 *
 * The read-before-edit invariant runs through all three: Read stamps the file in
 * the ledger with the stamp captured ATOMICALLY at read time; Write (overwrite)
 * and Edit refuse to touch a file that was never read, was deleted since it was
 * read, or changed on disk since it was read, returning an actionable error so
 * the agent re-reads instead of clobbering. Mutations emit file_change events so
 * the TUI's diff view stays live without the bulky content re-entering the
 * transcript.
 */

import { inferLanguage, isSecretPath, looksLikeSecret } from "@blazecoder/shared";
import { computeFileDiff } from "../../diff";
import { WorkspaceBoundaryError } from "../../workspace/boundary";
import type { Tool, ToolContext, ToolResult } from "../registry";
import { TOOL_NAMES } from "../toolNames";

const MAX_READ_LINES = 2000;
const MAX_LINE_LEN = 2000;

function asString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

function asNumber(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberedLines(lines: string[], startLine: number): string {
  return lines
    .map((line, i) => {
      const truncated = line.length > MAX_LINE_LEN ? `${line.slice(0, MAX_LINE_LEN)}… [line truncated]` : line;
      return `${String(startLine + i).padStart(6)}\t${truncated}`;
    })
    .join("\n");
}

/** Resolve a tool's file_path into the workspace, mapping boundary errors to a tool error. */
function resolvePath(
  ctx: ToolContext,
  input: Record<string, unknown>,
): { abs: string } | { error: string } {
  const filePath = asString(input, "file_path");
  if (!filePath) return { error: "Requires a 'file_path' string (absolute)." };
  try {
    const abs = ctx.workspace.resolve(filePath);
    if (isSecretPath(abs)) return { error: `Refusing to access a secret/credential file: ${filePath}` };
    return { abs };
  } catch (err) {
    if (err instanceof WorkspaceBoundaryError) return { error: err.message };
    throw err;
  }
}

export const readFileTool: Tool = {
  name: TOOL_NAMES.read,
  readOnly: true,
  compactable: true, // the file can be re-read (and is re-injected fresh after compaction)
  description: `Read a file from the filesystem.

- file_path must be an ABSOLUTE path, not relative.
- Returns up to 2000 lines from the start by default, each prefixed with its 1-indexed line number and a tab (like \`cat -n\`). For a large file, pass offset (1-indexed first line) and limit (line count) to read a window.
- This tool reads FILES, not directories. To list a directory use ${TOOL_NAMES.glob} or \`ls\` via ${TOOL_NAMES.bash}.
- Lines longer than 2000 chars are truncated. An empty file reads back with a note rather than content.
- Reading a file is REQUIRED before you may ${TOOL_NAMES.edit} it or overwrite it with ${TOOL_NAMES.write}; the line-number prefix you see here is display only — never include it in an Edit's old_string.`,
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Absolute path to the file, e.g. /Users/me/app/src/index.ts" },
      offset: { type: "number", description: "1-indexed first line to read (for large files)." },
      limit: { type: "number", description: "Number of lines to read from offset." },
    },
    required: ["file_path"],
    additionalProperties: false,
  },
  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const r = resolvePath(ctx, input);
    if ("error" in r) return { content: r.error, isError: true };
    const file = await ctx.workspace.read(r.abs);
    if (!file) return { content: `File not found: ${r.abs}.`, isError: true };

    if (file.content.includes("\u0000")) {
      // Binary: do not stamp the ledger (Edit/overwrite stays blocked) and do not dump bytes.
      return { content: `[binary file: ${r.abs} (${file.content.length} bytes) — not shown as text]` };
    }

    // Stamp the file with the stamp captured at read time, so a later Edit/Write
    // compares against exactly what was read (no separate stat() race).
    ctx.ledger.record(r.abs, file.stamp);

    const allLines = file.content.split("\n");
    const offset = Math.max(1, asNumber(input, "offset") ?? 1);
    const limit = Math.max(1, asNumber(input, "limit") ?? MAX_READ_LINES);
    const slice = allLines.slice(offset - 1, offset - 1 + limit);

    if (slice.length === 0) {
      return { content: `(${r.abs} has ${allLines.length} lines; offset ${offset} is past the end.)` };
    }
    const shown = offset - 1 + slice.length;
    const more = shown < allLines.length ? `\n…[${allLines.length - shown} more line(s); read with offset ${shown + 1}]` : "";
    return { content: `${numberedLines(slice, offset)}${more}` };
  },
};

export const writeFileTool: Tool = {
  name: TOOL_NAMES.write,
  readOnly: false,
  description: `Create a new file, or fully overwrite an existing one, at an absolute file_path with the COMPLETE content.

- To overwrite an existing file you must ${TOOL_NAMES.read} it first (so you don't discard content you haven't seen).
- Prefer ${TOOL_NAMES.edit} for changing part of an existing file — only use ${TOOL_NAMES.write} to create a file or replace it wholesale.
- Do NOT emit a file by shelling out (\`echo >\`, \`cat <<EOF\`) — use this tool.
- Never write secrets/credentials; never create documentation files unless asked.`,
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Absolute path to write." },
      content: { type: "string", description: "Full file content." },
    },
    required: ["file_path", "content"],
    additionalProperties: false,
  },
  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const r = resolvePath(ctx, input);
    if ("error" in r) return { content: r.error, isError: true };
    const content = asString(input, "content");
    if (content === undefined) return { content: "Write requires a 'content' string.", isError: true };
    if (!ctx.workspace.isWritable(r.abs)) {
      return { content: `Path is outside the writable workspace: ${r.abs}`, isError: true };
    }
    if (looksLikeSecret(content)) {
      return { content: "Refusing to write content that appears to contain a secret (API key/private key).", isError: true };
    }

    // read() == null means the file does not exist → a fresh create (no read required). For an
    // overwrite we load the old content here both to enforce read-before-write AND to diff against.
    const existing = await ctx.workspace.read(r.abs);
    if (existing) {
      if (!ctx.ledger.has(r.abs)) {
        return { content: `${r.abs} already exists. Read it before overwriting so you do not discard content.`, isError: true };
      }
      if (ctx.ledger.isStale(r.abs, existing.stamp)) {
        return { content: `${r.abs} changed on disk since you read it. Read it again before overwriting.`, isError: true };
      }
    }

    const language = inferLanguage(r.abs);
    await ctx.workspace.write({ path: r.abs, language, content });
    const after = await ctx.workspace.stat(r.abs);
    if (after) ctx.ledger.record(r.abs, after);
    const diff = computeFileDiff(existing?.content ?? "", content, existing ? "write" : "create");
    ctx.emit({ type: "file_change", op: "write", path: r.abs, language, diff });
    const lines = content === "" ? 0 : content.split("\n").length;
    return { content: `Wrote ${r.abs} (${lines} line${lines === 1 ? "" : "s"}).` };
  },
};

export const editFileTool: Tool = {
  name: TOOL_NAMES.edit,
  readOnly: false,
  description: `Replace an exact string in an existing file. You must ${TOOL_NAMES.read} the file first.

- When copying text from ${TOOL_NAMES.read} output, preserve the exact indentation as it appears AFTER the line-number prefix (the prefix is "padded line number + tab"). NEVER include any part of that line-number prefix in old_string or new_string.
- The edit FAILS if old_string is not unique — include enough surrounding context to match exactly once, or set replace_all: true to change every occurrence.
- old_string must be non-empty and must differ from new_string. Prefer several small, precise edits over one sweeping one.`,
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Absolute path of the file to edit." },
      old_string: { type: "string", description: "Exact text to replace (non-empty; unique unless replace_all)." },
      new_string: { type: "string", description: "Replacement text." },
      replace_all: { type: "boolean", description: "Replace every occurrence (default false)." },
    },
    required: ["file_path", "old_string", "new_string"],
    additionalProperties: false,
  },
  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const r = resolvePath(ctx, input);
    if ("error" in r) return { content: r.error, isError: true };
    const oldString = asString(input, "old_string");
    const newString = asString(input, "new_string");
    const replaceAll = input.replace_all === true;
    if (oldString === undefined || newString === undefined) {
      return { content: "Edit requires 'old_string' and 'new_string'.", isError: true };
    }
    if (oldString === "") {
      return { content: "old_string cannot be empty. Use Write to create a file from scratch.", isError: true };
    }
    if (oldString === newString) {
      return { content: "old_string and new_string are identical; nothing to change.", isError: true };
    }
    if (!ctx.workspace.isWritable(r.abs)) {
      return { content: `Path is outside the writable workspace: ${r.abs}`, isError: true };
    }
    if (!ctx.ledger.has(r.abs)) {
      return { content: `Read ${r.abs} before editing it.`, isError: true };
    }

    const file = await ctx.workspace.read(r.abs);
    if (!file) return { content: `File not found: ${r.abs} (deleted since you read it?). Use Write to create it.`, isError: true };
    // file.stamp is captured atomically with the content; compare to what was read.
    if (ctx.ledger.isStale(r.abs, file.stamp)) {
      return { content: `${r.abs} changed on disk since you read it. Read it again before editing.`, isError: true };
    }

    const occurrences = file.content.split(oldString).length - 1;
    if (occurrences === 0) {
      return { content: `old_string not found in ${r.abs}. Read the file and copy the exact text (including whitespace).`, isError: true };
    }
    if (occurrences > 1 && !replaceAll) {
      return {
        content: `old_string appears ${occurrences} times in ${r.abs}. Add surrounding context to make it unique, or set replace_all: true.`,
        isError: true,
      };
    }

    const updated = replaceAll
      ? file.content.split(oldString).join(newString)
      : file.content.replace(oldString, newString);
    await ctx.workspace.write({ path: r.abs, language: file.language, content: updated });
    const after = await ctx.workspace.stat(r.abs);
    if (after) ctx.ledger.record(r.abs, after);
    const diff = computeFileDiff(file.content, updated, "edit");
    ctx.emit({ type: "file_change", op: "edit", path: r.abs, language: file.language, diff });
    return { content: `Edited ${r.abs} (${occurrences} replacement${occurrences === 1 ? "" : "s"}).` };
  },
};
