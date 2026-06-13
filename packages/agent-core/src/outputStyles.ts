/**
 * Markdown output-style loader. An output style is a `<dir>/output-styles/*.md`
 * file whose body reshapes how the agent responds. By default the style is appended
 * to the system prompt (PromptContext.extra); a style with frontmatter
 * `keepCodingInstructions: false` REPLACES the base prompt (PromptContext.override).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./orchestration/loadAgents";

export interface OutputStyle {
  name: string;
  description: string;
  prompt: string;
  /** false ⇒ this style replaces the base prompt instead of augmenting it. */
  keepCodingInstructions?: boolean;
}

function toStyle(text: string, fallbackName: string): OutputStyle | null {
  const { data, body } = parseFrontmatter(text);
  if (!body.trim()) return null;
  return {
    name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : fallbackName,
    description: typeof data.description === "string" ? data.description : `Output style: ${fallbackName}`,
    prompt: body,
    keepCodingInstructions: data.keepCodingInstructions === "false" ? false : data.keepCodingInstructions === "true" ? true : undefined,
  };
}

/** Scan output-style dirs (later dirs override earlier ones by name). Never throws. */
export function loadOutputStyles(styleDirs: string[]): OutputStyle[] {
  const byName = new Map<string, OutputStyle>();
  for (const dir of styleDirs) {
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }
    for (const file of files.sort()) {
      try {
        const style = toStyle(readFileSync(join(dir, file), "utf8"), file.replace(/\.md$/, ""));
        if (style) byName.set(style.name, style);
      } catch {
        // ignore unreadable styles
      }
    }
  }
  return [...byName.values()];
}

/** Resolve a style by name into the prompt-shaping AgentRuntime options. */
export function outputStyleOptions(style: OutputStyle | undefined): { system?: string; extraInstructions?: string } {
  if (!style) return {};
  return style.keepCodingInstructions === false ? { system: style.prompt } : { extraInstructions: style.prompt };
}
