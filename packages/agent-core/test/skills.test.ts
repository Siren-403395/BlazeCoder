import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandSkillBody, loadSkills, makeSkillTool } from "../src/index";
import type { Skill, SubagentRunResult } from "../src/index";
import { makeCtx } from "./fakes";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "zc-skills-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function writeSkill(root: string, name: string, content: string) {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, "SKILL.md"), content);
}

describe("loadSkills", () => {
  it("parses inline/fork skills and lets project override user by name", () => {
    const user = tmp();
    const project = tmp();
    writeSkill(user, "commit", "---\nname: commit\ndescription: user commit\ncontext: inline\n---\nuser body");
    writeSkill(project, "commit", "---\nname: commit\ndescription: project commit\ncontext: fork\nallowedTools: [Read, Bash]\n---\nproject body");
    const skills = loadSkills([user, project]);
    const commit = skills.find((s) => s.name === "commit")!;
    expect(commit.description).toBe("project commit"); // project wins
    expect(commit.context).toBe("fork");
    expect(commit.allowedTools).toEqual(["Read", "Bash"]);
  });

  it("expandSkillBody substitutes $ARGUMENTS and ${SKILL_DIR}", () => {
    const skill: Skill = { name: "x", description: "d", context: "inline", body: "Do $ARGUMENTS in ${SKILL_DIR}", dir: "/skills/x" };
    expect(expandSkillBody(skill, "the thing")).toBe("Do the thing in /skills/x");
  });
});

describe("Skill tool", () => {
  const inline: Skill = { name: "explain", description: "explain code", context: "inline", body: "Explain: $ARGUMENTS", dir: "/s/explain" };
  const fork: Skill = { name: "review", description: "review code", context: "fork", allowedTools: ["Read"], body: "Review the diff", dir: "/s/review" };

  it("an inline skill returns its substituted body as the tool result", async () => {
    const { ctx } = makeCtx();
    const res = await makeSkillTool([inline]).execute({ name: "explain", arguments: "the parser" }, ctx);
    expect(res.isError).toBeFalsy();
    expect(res.content).toBe("Explain: the parser");
  });

  it("a fork skill spawns a sub-agent (with the right def) and returns its report", async () => {
    const { ctx } = makeCtx();
    let spawnedDef: { name: string; tools?: string[] } | undefined;
    ctx.spawn = async (def, prompt): Promise<SubagentRunResult> => {
      spawnedDef = { name: def.name, tools: def.tools };
      return { text: `reviewed: ${prompt}`, turns: 1, subtype: "success" };
    };
    const res = await makeSkillTool([fork]).execute({ name: "review" }, ctx);
    expect(res.content).toBe("reviewed: Review the diff");
    expect(spawnedDef).toEqual({ name: "skill:review", tools: ["Read"] });
  });

  it("errors on an unknown skill", async () => {
    const { ctx } = makeCtx();
    expect((await makeSkillTool([inline]).execute({ name: "nope" }, ctx)).isError).toBe(true);
  });
});
