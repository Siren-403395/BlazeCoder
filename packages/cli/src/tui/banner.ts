/**
 * The welcome wordmark, hand-set as a 7-row pixel font (no figlet dependency). Each
 * glyph is 5 cells wide and letters are joined with a 2-space gutter so the blocks read
 * as distinct letters, not a smear. The product name is "ZephyrCode" in camelCase:
 * capitals (Z, C) and ascenders (h, d) fill rows 0–5; x-height letters (e, o, r) sit in
 * rows 1–5; descenders (p, y) drop a tail into row 6. Rendered big + framed on the
 * welcome, with a compact chip fallback for narrow terminals (see view.tsx).
 */

const GLYPHS: Record<string, string[]> = {
  // Capitals — full height, rows 0–5.
  Z: ["█████", "   ██", "  ██ ", " ██  ", "██   ", "█████", "     "],
  C: [" ████", "██   ", "█    ", "█    ", "██   ", " ████", "     "],
  // Ascenders — tall stem to row 0.
  h: ["█    ", "█    ", "█    ", "████ ", "█  █ ", "█  █ ", "     "],
  d: ["    █", "    █", "    █", " ████", "█   █", " ████", "     "],
  // x-height letters — rows 1–5 (a touch shorter than the caps).
  e: ["     ", " ███ ", "█   █", "█████", "█    ", " ███ ", "     "],
  o: ["     ", " ███ ", "█   █", "█   █", "█   █", " ███ ", "     "],
  r: ["     ", "█ ██ ", "██   ", "█    ", "█    ", "█    ", "     "],
  // Descenders — bowl/body in rows 1–4, a tail dropping into row 6.
  p: ["     ", "████ ", "█   █", "█   █", "████ ", "█    ", "█    "],
  y: ["     ", "█   █", "█   █", "█   █", " ████", "    █", "████ "],
};

const NAME = "ZephyrCode";

/** The wordmark as 7 rows of block art (one row per scan-line, letters joined by a 2-space gutter). */
export const WORDMARK_ROWS: string[] = [0, 1, 2, 3, 4, 5, 6].map((r) =>
  NAME.split("")
    .map((c) => GLYPHS[c]![r])
    .join("  "),
);

/** Display width of the block wordmark (drives the big-vs-compact decision). */
export const WORDMARK_WIDTH = WORDMARK_ROWS[0]!.length;

export const TAGLINE = "a command-line coding agent";
