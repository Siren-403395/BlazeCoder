/**
 * Filesystem tools over the virtual project workspace: list_files, read_file,
 * write_file, edit_file, delete_file. Mutations emit file_change events so the
 * frontend file tree + code viewer stay live without the model re-emitting bulky
 * content into the transcript.
 */

import { inferLanguage } from "@coding-agent/shared";
import type { Tool, ToolContext, ToolResult } from "../registry";

function asString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

function asNumber(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberedLines(content: string, startLine: number): string {
  return content
    .split("\n")
    .map((line, i) => `${String(startLine + i).padStart(6)}\t${line}`)
    .join("\n");
}

export const listFilesTool: Tool = {
  name: "list_files",
  readOnly: true,
  description:
    "List every file currently in the project workspace with its size in bytes. Use this first to understand what exists before reading or editing. Returns paths (always absolute, starting with '/').",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async execute(_input, ctx: ToolContext): Promise<ToolResult> {
    const files = ctx.workspace.list();
    if (files.length === 0) {
      return { content: "The project workspace is empty. Use write_file to create files." };
    }
    const lines = files
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((f) => `${f.path}  (${f.content.length} bytes)`);
    return { content: `${files.length} file(s):\n${lines.join("\n")}` };
  },
};

export const readFileTool: Tool = {
  name: "read_file",
  readOnly: true,
  description:
    "Read a file from the project workspace. Returns content with 1-indexed line numbers. Optionally pass start_line and end_line to read only a range (recommended for large files to save context).",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute project path, e.g. /src/App.tsx" },
      start_line: { type: "number", description: "1-indexed first line to read (optional)" },
      end_line: { type: "number", description: "1-indexed last line to read (optional)" },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const path = asString(input, "path");
    if (!path) return { content: "read_file requires a 'path' string.", isError: true };
    const file = ctx.workspace.read(path);
    if (!file) {
      return { content: `File not found: ${path}. Use list_files to see what exists.`, isError: true };
    }
    const start = asNumber(input, "start_line");
    const end = asNumber(input, "end_line");
    if (start === undefined && end === undefined) {
      return { content: numberedLines(file.content, 1) };
    }
    const allLines = file.content.split("\n");
    const from = Math.max(1, start ?? 1);
    const to = Math.min(allLines.length, end ?? allLines.length);
    const slice = allLines.slice(from - 1, to).join("\n");
    return { content: numberedLines(slice, from) };
  },
};

export const writeFileTool: Tool = {
  name: "write_file",
  readOnly: false,
  description:
    "Create a new file or fully overwrite an existing one in the project workspace. Path must be absolute (start with '/'). Use edit_file for targeted changes to an existing file.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute project path, e.g. /src/components/Button.tsx" },
      content: { type: "string", description: "Full file content." },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const path = asString(input, "path");
    const content = asString(input, "content");
    if (!path || content === undefined) {
      return { content: "write_file requires 'path' and 'content' strings.", isError: true };
    }
    const language = inferLanguage(path);
    ctx.workspace.write({ path, language, content });
    ctx.emit({ type: "file_change", op: "write", path, language, content });
    return { content: `Wrote ${path} (${content.length} chars).` };
  },
};

export const editFileTool: Tool = {
  name: "edit_file",
  readOnly: false,
  description:
    "Make a targeted edit to an existing file by replacing an exact string. The old_string must appear EXACTLY once (include enough surrounding context to be unique), unless replace_all is true. Read the file first.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute project path of the file to edit." },
      old_string: { type: "string", description: "Exact text to replace (must be unique unless replace_all)." },
      new_string: { type: "string", description: "Replacement text." },
      replace_all: { type: "boolean", description: "Replace every occurrence (default false)." },
    },
    required: ["path", "old_string", "new_string"],
    additionalProperties: false,
  },
  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const path = asString(input, "path");
    const oldString = asString(input, "old_string");
    const newString = asString(input, "new_string");
    const replaceAll = input.replace_all === true;
    if (!path || oldString === undefined || newString === undefined) {
      return {
        content: "edit_file requires 'path', 'old_string', and 'new_string'.",
        isError: true,
      };
    }
    const file = ctx.workspace.read(path);
    if (!file) return { content: `File not found: ${path}. Use write_file to create it.`, isError: true };

    const occurrences = file.content.split(oldString).length - 1;
    if (occurrences === 0) {
      return { content: `old_string not found in ${path}. Read the file and copy the exact text.`, isError: true };
    }
    if (occurrences > 1 && !replaceAll) {
      return {
        content: `old_string appears ${occurrences} times in ${path}. Add surrounding context to make it unique, or set replace_all: true.`,
        isError: true,
      };
    }
    const updated = replaceAll
      ? file.content.split(oldString).join(newString)
      : file.content.replace(oldString, newString);
    ctx.workspace.write({ ...file, content: updated });
    ctx.emit({ type: "file_change", op: "edit", path, language: file.language, content: updated });
    return { content: `Edited ${path} (${occurrences} replacement${occurrences > 1 ? "s" : ""}).` };
  },
};

export const deleteFileTool: Tool = {
  name: "delete_file",
  readOnly: false,
  description: "Delete a file from the project workspace. Use sparingly.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "Absolute project path to delete." } },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const path = asString(input, "path");
    if (!path) return { content: "delete_file requires a 'path' string.", isError: true };
    const existed = ctx.workspace.delete(path);
    if (!existed) return { content: `File not found: ${path}.`, isError: true };
    ctx.emit({ type: "file_change", op: "delete", path });
    return { content: `Deleted ${path}.` };
  },
};
