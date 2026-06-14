/**
 * Pure, UI-agnostic label helper for a tool call — used by the headless renderer to print a
 * one-line summary of a tool invocation. Imports nothing, so it is safe in any environment.
 * The TUI keeps its own copy alongside its color theme (cli/src/tui/theme.ts); a host package
 * carries no terminal presentation beyond this.
 */

/** A compact one-line label for a tool call's salient argument. */
export function toolDetail(name: string, input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : undefined);
  switch (name) {
    case "Read":
    case "Write":
    case "Edit":
      return s("file_path") ?? "";
    case "Bash":
      return s("command") ?? "";
    case "Glob":
      return s("pattern") ?? "";
    case "Grep":
      return s("pattern") ?? "";
    case "memory":
      return s("command") ?? "";
    default: {
      const first = Object.values(input)[0];
      return typeof first === "string" ? first : "";
    }
  }
}
