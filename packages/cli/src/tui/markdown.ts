/**
 * Markdown -> ANSI rendering for the TUI. We deliberately do NOT hand-roll a
 * parser: assistant replies are real Markdown, so we run them through `marked`
 * (the parser) + `marked-terminal` (an ANSI renderer) and drop the resulting
 * string straight into an Ink <Text>. Ink measures and wraps ANSI-aware, so the
 * escape codes survive layout. The configured instance is cached per width.
 *
 * Only finalized assistant text is rendered as Markdown — streaming text stays
 * raw so a half-typed code fence or list never reflows mid-stream.
 */

import { Marked, type MarkedExtension } from "marked";
import { markedTerminal } from "marked-terminal";

let cached: { width: number; marked: Marked } | null = null;

function instance(width: number): Marked {
  if (cached && cached.width === width) return cached.marked;
  const marked = new Marked();
  // @types/marked-terminal@6 still types this as the legacy TerminalRenderer;
  // marked-terminal@7 actually returns a MarkedExtension ({ renderer, ... }).
  const extension = markedTerminal({
      // Reflow prose to the terminal width; Ink then lays the result out as-is.
      width,
      reflowText: true,
      // Headings are styled (bold/underline/color); we don't want a literal "# ".
      showSectionPrefix: false,
      // Tab width for nested lists / code blocks.
      tab: 2,
    }) as unknown as MarkedExtension;
  marked.use(extension);
  cached = { width, marked };
  return marked;
}

/** Render Markdown to an ANSI string sized to `width`. Never throws. */
export function renderMarkdown(md: string, width = 80): string {
  try {
    const out = instance(Math.max(20, Math.floor(width))).parse(md);
    return (typeof out === "string" ? out : md).replace(/\s+$/, "");
  } catch {
    return md; // a markdown hiccup must never crash the render loop.
  }
}
