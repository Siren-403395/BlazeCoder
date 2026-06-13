import { describe, expect, it } from "vitest";
import { ALL_TOOL_NAMES, builtinTools, TOOL_NAMES } from "../src/index";

describe("TOOL_NAMES is the single source of truth for tool names", () => {
  it("the built-in registry registers exactly the canonical names, in order", () => {
    const names = builtinTools().map((t) => t.name);
    expect(names).toEqual([
      TOOL_NAMES.read,
      TOOL_NAMES.write,
      TOOL_NAMES.edit,
      TOOL_NAMES.glob,
      TOOL_NAMES.grep,
      TOOL_NAMES.bash,
      TOOL_NAMES.memory,
    ]);
  });

  it("every registered built-in name is a value in TOOL_NAMES (no drift)", () => {
    for (const tool of builtinTools()) {
      expect(ALL_TOOL_NAMES).toContain(tool.name);
    }
  });

  it("never references the non-existent legacy names", () => {
    const registered = builtinTools().map((t) => t.name);
    for (const ghost of ["read_file", "write_file", "edit_file", "list_files", "delete_file", "run_command"]) {
      expect(registered).not.toContain(ghost);
    }
  });
});
