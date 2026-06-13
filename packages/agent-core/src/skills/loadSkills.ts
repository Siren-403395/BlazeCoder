/**
 * Markdown SKILL loader. A skill is a `<dir>/skills/<name>/SKILL.md` with YAML-ish
 * frontmatter and a Markdown body. Skills are reusable prompt recipes the model (or
 * the user, via /<name>) can invoke:
 *   - context: "inline" → the body is expanded into the conversation as-is.
 *   - context: "fork"   → the body runs as a sub-agent (filtered to allowedTools).
 * Definitions dedupe by real path; project scope overrides user scope by name.
 */

import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { Effort } from "../effort";
import { parseFrontmatter } from "../orchestration/loadAgents";

export interface Skill {
  name: string;
  description: string;
  whenToUse?: string;
  allowedTools?: string[];
  effort?: Effort;
  context: "inline" | "fork";
  body: string;
  dir: string;
}

const EFFORTS = new Set(["low", "high", "ultra"]);

function toSkill(text: string, dir: string): Skill | null {
  const { data, body } = parseFrontmatter(text);
  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name) return null;
  const tools = Array.isArray(data.allowedTools)
    ? (data.allowedTools as unknown[]).filter((t): t is string => typeof t === "string")
    : undefined;
  const effort = typeof data.effort === "string" && EFFORTS.has(data.effort) ? (data.effort as Effort) : undefined;
  return {
    name,
    description: typeof data.description === "string" ? data.description : `Skill: ${name}`,
    whenToUse: typeof data.whenToUse === "string" ? data.whenToUse : undefined,
    allowedTools: tools && tools.length ? tools : undefined,
    effort,
    context: data.context === "fork" ? "fork" : "inline",
    body,
    dir,
  };
}

/**
 * Scan skill dirs (each holding `<name>/SKILL.md`) and return the merged skills.
 * Dedupes by the resolved real path (so a symlinked dir isn't loaded twice); later
 * dirs override earlier ones by skill name. Never throws.
 */
export function loadSkills(skillDirs: string[]): Skill[] {
  const byName = new Map<string, Skill>();
  const seenPaths = new Set<string>();

  for (const root of skillDirs) {
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries.sort()) {
      const file = join(root, entry, "SKILL.md");
      let real: string;
      try {
        real = realpathSync(file);
      } catch {
        continue; // no SKILL.md in this entry
      }
      if (seenPaths.has(real)) continue;
      seenPaths.add(real);
      try {
        const skill = toSkill(readFileSync(real, "utf8"), join(root, entry));
        if (skill) byName.set(skill.name, skill);
      } catch {
        // ignore unreadable skills
      }
    }
  }

  return [...byName.values()];
}

/** Expand a skill body, substituting $ARGUMENTS and ${SKILL_DIR}. */
export function expandSkillBody(skill: Skill, args = ""): string {
  return skill.body.split("$ARGUMENTS").join(args).split("${SKILL_DIR}").join(skill.dir);
}
