/**
 * The welcome wordmark, hand-set as a 5-row pixel font (no figlet dependency). Each
 * glyph is 4 cells wide; letters are joined with a single-space gutter. We render the
 * full product name "ZEPHYRCODE" big, framed, on the welcome + a compact chip fallback
 * for narrow terminals (see view.tsx).
 */

const GLYPHS: Record<string, string[]> = {
  Z: ["████", "  ██", " ██ ", "██  ", "████"],
  E: ["████", "█   ", "███ ", "█   ", "████"],
  P: ["███ ", "█  █", "███ ", "█   ", "█   "],
  H: ["█  █", "█  █", "████", "█  █", "█  █"],
  Y: ["█  █", "█  █", " ██ ", " █  ", " █  "],
  R: ["███ ", "█  █", "███ ", "█ █ ", "█  █"],
  C: [" ███", "█   ", "█   ", "█   ", " ███"],
  O: [" ██ ", "█  █", "█  █", "█  █", " ██ "],
  D: ["███ ", "█  █", "█  █", "█  █", "███ "],
};

const NAME = "ZEPHYRCODE";

/** The wordmark as 5 rows of block art (one row per scan-line, letters space-joined). */
export const WORDMARK_ROWS: string[] = [0, 1, 2, 3, 4].map((r) =>
  NAME.split("")
    .map((c) => GLYPHS[c]![r])
    .join(" "),
);

/** Display width of the block wordmark (drives the big-vs-compact decision). */
export const WORDMARK_WIDTH = WORDMARK_ROWS[0]!.length;

export const TAGLINE = "a command-line coding agent";
