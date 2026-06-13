/**
 * The model-callable `Skill` tool. Invokes a loaded skill by name:
 *   - inline skills return their (argument-substituted) body as the tool result, so
 *     the model reads the recipe and continues in the same context.
 *   - fork skills run as a sub-agent (filtered to allowedTools) and return its report.
 */

import type { Tool, ToolContext, ToolResult } from "../tools/registry";
import { TOOL_NAMES } from "../tools/toolNames";
import { expandSkillBody, type Skill } from "./loadSkills";

export function makeSkillTool(skills: Skill[]): Tool {
  const byName = new Map(skills.map((s) => [s.name, s]));
  const menu = skills.map((s) => `- ${s.name}: ${s.description}${s.whenToUse ? ` (use when: ${s.whenToUse})` : ""}`).join("\n");

  return {
    name: TOOL_NAMES.skill,
    readOnly: false,
    description: `Run a project skill — a reusable prompt recipe. Pass the skill name and optional arguments.

Available skills:
${menu || "(none)"}`,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", enum: skills.map((s) => s.name), description: "The skill to run." },
        arguments: { type: "string", description: "Free-form arguments substituted into the skill ($ARGUMENTS)." },
      },
      required: ["name"],
      additionalProperties: false,
    },

    async execute(input, ctx: ToolContext): Promise<ToolResult> {
      const name = typeof input.name === "string" ? input.name : "";
      const skill = byName.get(name);
      if (!skill) return { content: `Unknown skill "${name}". Available: ${[...byName.keys()].join(", ") || "(none)"}.`, isError: true };
      const args = typeof input.arguments === "string" ? input.arguments : "";
      const body = expandSkillBody(skill, args);

      if (skill.context === "inline") {
        return { content: body };
      }
      // fork: run the skill as a sub-agent restricted to its allowedTools.
      if (!ctx.spawn || (ctx.depth ?? 0) > 0) {
        return { content: "This skill must run as a sub-agent, which isn't available here (no nesting).", isError: true };
      }
      const result = await ctx.spawn(
        { name: `skill:${skill.name}`, description: skill.description, tools: skill.allowedTools },
        body,
        ctx.signal,
      );
      return { content: result.text || `Skill ${skill.name} finished (${result.subtype}) with no output.` };
    },
  };
}
