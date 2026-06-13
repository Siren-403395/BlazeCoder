/**
 * Maps a tool name to display metadata for the activity stream. Pure and
 * framework-agnostic: it returns an `icon` *key* (a string), so the rendering
 * layer owns the actual icon component (see ui/ToolIcon).
 */

export type ToolIconKey =
  | "list"
  | "read"
  | "write"
  | "edit"
  | "delete"
  | "search"
  | "glob"
  | "preview"
  | "shell"
  | "memory"
  | "tool";

export interface ToolMeta {
  /** Short verb shown as the activity label, e.g. "Edit". */
  label: string;
  icon: ToolIconKey;
  /** The most relevant argument as a one-line detail, e.g. a file path. */
  detail: string;
  /** True when the tool mutates a file that exists in the file graph (so it can be opened). */
  openable: boolean;
}

interface ToolRow {
  label: string;
  icon: ToolIconKey;
  /** Which input field to surface as the detail. */
  arg?: string;
  /** Only write/edit land in the file graph; read/list/delete do not open to a file. */
  openable?: true;
}

const TABLE: Record<string, ToolRow> = {
  list_files: { label: "List", icon: "list", arg: "path" },
  read_file: { label: "Read", icon: "read", arg: "path" },
  write_file: { label: "Write", icon: "write", arg: "path", openable: true },
  edit_file: { label: "Edit", icon: "edit", arg: "path", openable: true },
  delete_file: { label: "Delete", icon: "delete", arg: "path" },
  grep: { label: "Search", icon: "search", arg: "pattern" },
  glob: { label: "Find", icon: "glob", arg: "pattern" },
  build_preview: { label: "Preview", icon: "preview" },
  run_command: { label: "Run", icon: "shell", arg: "command" },
  memory: { label: "Memory", icon: "memory", arg: "command" },
};

export function toolMeta(name: string, input?: Record<string, unknown>): ToolMeta {
  const row = TABLE[name];
  if (!row) return { label: name, icon: "tool", detail: argString(input), openable: false };
  const detail = row.arg ? str(input?.[row.arg]) : "";
  return { label: row.label, icon: row.icon, detail, openable: !!row.openable };
}

function str(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return String(value);
}

/** Fallback: surface the first scalar argument for unknown tools. */
function argString(input?: Record<string, unknown>): string {
  if (!input) return "";
  for (const v of Object.values(input)) {
    if (typeof v === "string" || typeof v === "number") return String(v);
  }
  return "";
}
