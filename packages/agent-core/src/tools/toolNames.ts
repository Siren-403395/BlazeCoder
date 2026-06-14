/**
 * Single source of truth for built-in tool names.
 *
 * Every tool's `name` field AND every reference to a tool in the system prompt /
 * tool descriptions / agent definitions MUST go through this constant. The
 * reference clone keeps a per-tool name constant for exactly this reason: prose
 * and registration can never drift. (blazecoder previously hard-coded snake_case
 * names — read_file/write_file/list_files — in the prompt while registering
 * Read/Write/…, telling the model to call tools that do not resolve.)
 *
 * `list_files` and `delete_file` are NOT real tools and must never be referenced;
 * listing is Glob, deletion is Bash.
 */
export const TOOL_NAMES = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  glob: "Glob",
  grep: "Grep",
  bash: "Bash",
  memory: "memory",
  todo: "TodoWrite",
  task: "Task",
  skill: "Skill",
} as const;

export type ToolNameKey = keyof typeof TOOL_NAMES;
export type ToolName = (typeof TOOL_NAMES)[ToolNameKey];

/** All canonical tool names as a flat array (for guard tests + prompt audits). */
export const ALL_TOOL_NAMES: readonly string[] = Object.values(TOOL_NAMES);
