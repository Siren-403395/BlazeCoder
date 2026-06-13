import { describe, expect, it } from "vitest";
import { CORE_TOOLS, matchesRule, ToolRegistry, builtinTools } from "../src/index";
import type { Tool, ToolSource } from "../src/index";

describe("CORE_TOOLS scaffolding", () => {
  it("contains the always-loaded built-ins (minus Skill)", () => {
    for (const name of ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "memory", "TodoWrite", "Task"]) {
      expect(CORE_TOOLS.has(name)).toBe(true);
    }
    expect(CORE_TOOLS.has("Skill")).toBe(false);
  });

  it("optional searchHint/alwaysLoad are ignored by schemas()", () => {
    const reg = new ToolRegistry().registerAll(builtinTools());
    for (const s of reg.schemas()) {
      expect(Object.keys(s).sort()).toEqual(["description", "inputSchema", "name"]);
    }
  });
});

describe("ToolSource port (MCP-shaped tools)", () => {
  const mcpPing: Tool = {
    name: "mcp__demo__ping",
    description: "ping the demo server",
    inputSchema: { type: "object" },
    readOnly: true,
    async execute() {
      return { content: "pong" };
    },
  };
  const source: ToolSource = { async tools() { return [mcpPing]; } };

  it("an MCP-named tool registers alongside the built-ins (name passes TOOL_NAME_RE)", async () => {
    const reg = new ToolRegistry().registerAll([...builtinTools(), ...(await source.tools())]);
    expect(reg.has("mcp__demo__ping")).toBe(true);
    expect(reg.has("Read")).toBe(true);
  });

  it("the permission rule grammar matches an MCP tool by server prefix", () => {
    // A whole-tool rule on the server matches any of its tools.
    expect(matchesRule({ toolName: "mcp__demo" }, "mcp__demo__ping", {})).toBe(true);
    expect(matchesRule({ toolName: "mcp__other" }, "mcp__demo__ping", {})).toBe(false);
  });
});
