import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRegistry, loadAgentDefinitions, makeTaskTool, parseFrontmatter } from "../src/index";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "zc-agents-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const VALID = ["Read", "Grep", "Glob", "Write", "Edit", "Bash"];

describe("parseFrontmatter", () => {
  it("splits frontmatter from body and parses inline/csv arrays", () => {
    const { data, body } = parseFrontmatter("---\nname: reviewer\ntools: [Read, Grep]\nmaxTurns: 8\n---\nReview the code.");
    expect(data.name).toBe("reviewer");
    expect(data.tools).toEqual(["Read", "Grep"]);
    expect(data.maxTurns).toBe("8");
    expect(body).toBe("Review the code.");
  });
});

describe("loadAgentDefinitions", () => {
  function writeAgent(dir: string, file: string, content: string) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), content);
  }

  it("merges user→project by name, drops invalid tools, and skips name-less files", () => {
    const user = tmp();
    const project = tmp();
    writeAgent(user, "reviewer.md", "---\nname: reviewer\ndescription: user version\ntools: [Read, Bogus]\n---\nuser body");
    writeAgent(user, "noname.md", "---\ndescription: no name here\n---\nbody"); // skipped
    writeAgent(project, "reviewer.md", "---\nname: reviewer\ndescription: project version\n---\nproject body"); // overrides user

    const { definitions, failedFiles } = loadAgentDefinitions([user, project], VALID);
    const reviewer = definitions.find((d) => d.name === "reviewer");
    expect(reviewer?.description).toBe("project version"); // project wins
    expect(reviewer?.tools).toBeUndefined(); // project version had no tools; user's Bogus dropped anyway
    expect(failedFiles.some((f) => f.endsWith("noname.md"))).toBe(true);
  });

  it("drops only the invalid tool names, keeping the valid ones", () => {
    const user = tmp();
    writeAgent(user, "a.md", "---\nname: scout\ntools: [Read, Glob, Nope]\n---\nbody");
    const { definitions } = loadAgentDefinitions([user], VALID);
    expect(definitions[0]!.tools).toEqual(["Read", "Glob"]);
  });

  it("missing dirs are a no-op", () => {
    expect(loadAgentDefinitions([join(tmp(), "nope")], VALID).definitions).toEqual([]);
  });
});

describe("AgentRegistry merges loaded agents over the built-ins", () => {
  it("a loaded 'reviewer' becomes a valid Task subagent_type alongside the built-ins", () => {
    const registry = new AgentRegistry([{ name: "reviewer", description: "reviews code" }]);
    expect(registry.get("reviewer")).toBeTruthy();
    expect(registry.get("builder")).toBeTruthy(); // built-in still present
    const types = (makeTaskTool(registry).inputSchema as { properties: { subagent_type: { enum: string[] } } }).properties.subagent_type.enum;
    expect(types).toContain("reviewer");
    expect(types).toContain("explorer");
  });
});
