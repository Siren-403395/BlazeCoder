/**
 * One locked accent (warm amber) over neutral grays, dark-terminal friendly.
 * Ink passes these straight to chalk, so hex values work everywhere.
 */
export const theme = {
  accent: "#e8a64d",
  accentDim: "#b9803b",
  text: "white",
  muted: "gray",
  faint: "#6b6b6b",
  success: "green",
  error: "red",
  warn: "yellow",
  info: "cyan",
  user: "#7aa2f7",
};

/** A short glyph per tool, used in the activity line. */
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
