/**
 * Markdown agent loader — custom sub-agent types are DATA: a `<dir>/agents/*.md`
 * file with YAML-ish frontmatter (name, description, optional tools/maxTurns/model)
 * and a Markdown body that becomes the agent's systemPrompt. Definitions merge over
 * the built-ins by name (later dir wins). Invalid tool names are dropped; a file
 * without a name is skipped into failedFiles (the loader never throws). The CLI
 * decides which dirs to scan and gates project-scope dirs behind workspace trust.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentDefinition } from "./agentRegistry";

export interface LoadedAgents {
  definitions: AgentDefinition[];
  /** Files that couldn't be loaded (no name / parse error), for a startup notice. */
  failedFiles: string[];
}

/** Split `---\nfrontmatter\n---\nbody` into a data record + body (minimal gray-matter). */
export function parseFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { data: {}, body: text };
  const data: Record<string, unknown> = {};
  for (const raw of m[1]!.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf(":");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value: string = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = value.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
    } else if (key === "tools" && value.includes(",")) {
      data[key] = value.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      data[key] = value;
    }
  }
  return { data, body: m[2]!.trim() };
}

function toDefinition(text: string, validToolNames: Set<string>): AgentDefinition | null {
  const { data, body } = parseFrontmatter(text);
  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name) return null; // no name → skipped (failedFiles)
  const rawTools = Array.isArray(data.tools) ? (data.tools as unknown[]).filter((t): t is string => typeof t === "string") : undefined;
  const tools = rawTools?.filter((t) => validToolNames.has(t)); // drop unknown tool names
  const maxTurns = typeof data.maxTurns === "string" && Number.isFinite(Number(data.maxTurns)) ? Number(data.maxTurns) : undefined;
  return {
    name,
    description: typeof data.description === "string" ? data.description : `Custom agent: ${name}`,
    ...(tools && tools.length ? { tools } : {}),
    ...(maxTurns ? { maxTurns } : {}),
    ...(body ? { systemPrompt: body } : {}),
  };
}

/**
 * Load + merge agent definitions from the given dirs (in precedence order: earlier
 * dirs are overridden by later ones, by name). Validates tool names against
 * validToolNames. Never throws.
 */
export function loadAgentDefinitions(agentDirs: string[], validToolNames: string[]): LoadedAgents {
  const valid = new Set(validToolNames);
  const byName = new Map<string, AgentDefinition>();
  const failedFiles: string[] = [];

  for (const dir of agentDirs) {
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch {
      continue; // dir doesn't exist → nothing to load
    }
    for (const file of files.sort()) {
      const path = join(dir, file);
      try {
        const def = toDefinition(readFileSync(path, "utf8"), valid);
        if (def) byName.set(def.name, def);
        else failedFiles.push(path);
      } catch {
        failedFiles.push(path);
      }
    }
  }

  return { definitions: [...byName.values()], failedFiles };
}
