/**
 * The welcome wordmark, hand-set as a 5-row pixel font (no figlet dependency). Each
 * glyph is 4 cells wide; letters are joined with a single-space gutter. The product
 * name is "ZephyrCode" in camelCase: capitals (Z, C) and ascenders (h, d) stand the
 * full 5 rows, while x-height letters (e, p, y, r, o) sit a row lower, so the mixed
 * case reads at a glance. Rendered big + framed on the welcome, with a compact chip
 * fallback for narrow terminals (see view.tsx).
 */

const GLYPHS: Record<string, string[]> = {
  // Capitals — full cap height (rows 0–4).
  Z: ["████", "  ██", " ██ ", "██  ", "████"],
  C: [" ███", "█   ", "█   ", "█   ", " ███"],
  // Ascenders — tall stem to row 0, bowl/shoulder at x-height.
  h: ["█   ", "█   ", "███ ", "█ █ ", "█ █ "],
  d: ["   █", "   █", " ███", "█  █", " ███"],
  // x-height letters — body in rows 1–4, row 0 blank (sit shorter than the capitals).
  e: ["    ", " ██ ", "█  █", "████", " ██ "],
  o: ["    ", " ██ ", "█  █", "█  █", " ██ "],
  r: ["    ", "█ ██", "██  ", "█   ", "█   "],
  p: ["    ", "███ ", "█  █", "███ ", "█   "], // bowl up top, stem to the baseline (descender)
  y: ["    ", "█  █", "█  █", " ███", "   █"], // arms merge into a right-hand tail (descender)
};

const NAME = "ZephyrCode";

/** The wordmark as 5 rows of block art (one row per scan-line, letters space-joined). */
export const WORDMARK_ROWS: string[] = [0, 1, 2, 3, 4].map((r) =>
  NAME.split("")
    .map((c) => GLYPHS[c]![r])
    .join(" "),
);

/** Display width of the block wordmark (drives the big-vs-compact decision). */
export const WORDMARK_WIDTH = WORDMARK_ROWS[0]!.length;

export const TAGLINE = "a command-line coding agent";
