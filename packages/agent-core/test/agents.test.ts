import { describe, expect, it } from "vitest";
import { AgentRegistry, builtinTools, DEFAULT_AGENTS } from "../src/index";

describe("DEFAULT_AGENTS tool names", () => {
  const registered = new Set(builtinTools().map((t) => t.name));

  it("every tool named in every agent definition is a real registered tool", () => {
    for (const agent of DEFAULT_AGENTS) {
      for (const tool of agent.tools ?? []) {
        expect(registered.has(tool), `agent "${agent.name}" references unregistered tool "${tool}"`).toBe(true);
      }
    }
  });

  it("the explorer agent is restricted to the real read-only tools (regression: was list_files/read_file ghosts)", () => {
    const explorer = new AgentRegistry().get("explorer");
    expect(explorer?.tools).toEqual(["Read", "Grep", "Glob"]);
  });
});
