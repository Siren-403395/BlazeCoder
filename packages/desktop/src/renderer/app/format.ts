/**
 * Pure presentational helpers for the renderer. Zero imports by design — the renderer
 * never reaches across packages for VALUES (the @zephyrcode/host barrel pulls node:fs /
 * child_process and would break Vite), so the GUI carries its own tiny copy of the tool
 * label helpers. The guard test enforces this isolation.
 */

/** A short glyph per tool. */
export function toolGlyph(name: string): string {
  switch (name) {
    case "Read":
      return "○";
    case "Write":
    case "Edit":
      return "✎";
    case "Bash":
      return "$";
    case "Glob":
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

/** Collapse a long path to its last three segments. */
export function shortPath(path: string | undefined): string {
  if (!path) return "";
  const parts = path.replaceAll("\\", "/").split("/");
  return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : path;
}

/** Pretty-print a tool's input object for the inspector. */
export function stringifyInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

/** Compact a token count: 12345 -> "12.3k". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
