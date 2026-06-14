/**
 * Pure, UI-agnostic label helpers for a tool call — used by the headless renderer
 * (and available to any host that wants a one-line summary of a tool invocation).
 * These import nothing, so they are safe to pull into any environment. The TUI keeps
 * its own copy of these alongside its color theme (cli/src/tui/theme.ts); a host
 * package carries no terminal colors.
 */

/** A short glyph per tool, used in an activity line. */
export function toolGlyph(name: string): string {
  switch (name) {
    case "Read":
      return "○";
    case "Write":
      return "✎";
    case "Edit":
      return "✎";
    case "Bash":
      return "$";
    case "Glob":
      return "⌕";
    case "Grep":
      return "⌕";
    case "memory":
      return "✱";
    default:
      return "•";
  }
}

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
