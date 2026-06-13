/**
 * The model-driven memory tool — Anthropic's memory_20250818 command vocabulary
 * (view / create / str_replace / insert / delete / rename), dispatched to the
 * injected MemoryStore (sandboxed to /memories). Lets the agent persist durable
 * notes across sessions and survive context compaction.
 */

import type { Tool, ToolContext, ToolResult } from "../tools/registry";

export const memoryTool: Tool = {
  name: "memory",
  readOnly: false,
  description:
    "Persistent memory sandboxed to /memories. Commands: view (read a file or list a dir), create (write a file), str_replace (replace exact text), insert (insert at a 1-indexed line), delete, rename. ALWAYS view /memories at the start of a task to recall prior context; your context window may reset at any time.",
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        enum: ["view", "create", "str_replace", "insert", "delete", "rename"],
      },
      path: { type: "string", description: "Path under /memories." },
      file_text: { type: "string", description: "Content for create." },
      old_str: { type: "string", description: "Text to replace for str_replace." },
      new_str: { type: "string", description: "Replacement text for str_replace." },
      insert_line: { type: "number", description: "1-indexed line for insert." },
      insert_text: { type: "string", description: "Text to insert." },
      old_path: { type: "string", description: "Source path for rename." },
      new_path: { type: "string", description: "Destination path for rename." },
    },
    required: ["command"],
    additionalProperties: false,
  },
  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const command = String(input.command ?? "");
    const str = (key: string): string | undefined =>
      typeof input[key] === "string" ? (input[key] as string) : undefined;
    const memory = ctx.memory;

    try {
      switch (command) {
        case "view": {
          const path = str("path") ?? "/memories";
          return { content: await memory.view(path) };
        }
        case "create": {
          const path = str("path");
          const text = str("file_text") ?? "";
          if (!path) return { content: "create requires 'path'.", isError: true };
          await memory.create(path, text);
          return { content: `Created ${path}.` };
        }
        case "str_replace": {
          const path = str("path");
          const oldStr = str("old_str");
          const newStr = str("new_str") ?? "";
          if (!path || oldStr === undefined) {
            return { content: "str_replace requires 'path' and 'old_str'.", isError: true };
          }
          await memory.strReplace(path, oldStr, newStr);
          return { content: `Updated ${path}.` };
        }
        case "insert": {
          const path = str("path");
          const line = typeof input.insert_line === "number" ? input.insert_line : undefined;
          const text = str("insert_text") ?? "";
          if (!path || line === undefined) {
            return { content: "insert requires 'path' and 'insert_line'.", isError: true };
          }
          await memory.insert(path, line, text);
          return { content: `Inserted into ${path} at line ${line}.` };
        }
        case "delete": {
          const path = str("path");
          if (!path) return { content: "delete requires 'path'.", isError: true };
          await memory.remove(path);
          return { content: `Deleted ${path}.` };
        }
        case "rename": {
          const from = str("old_path");
          const to = str("new_path");
          if (!from || !to) return { content: "rename requires 'old_path' and 'new_path'.", isError: true };
          await memory.rename(from, to);
          return { content: `Renamed ${from} -> ${to}.` };
        }
        default:
          return { content: `Unknown memory command: ${command}.`, isError: true };
      }
    } catch (error) {
      return { content: `memory ${command} failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
    }
  },
};
