import { describe, expect, it } from "vitest";
import { builtinTools } from "../src/index";

const byName = Object.fromEntries(builtinTools().map((t) => [t.name, t]));

describe("reference-grade tool descriptions", () => {
  it("Read explains the line-number prefix and directory caveat", () => {
    expect(byName.Read!.description).toContain("line-number prefix");
    expect(byName.Read!.description).toMatch(/ABSOLUTE path/);
  });

  it("Edit warns about the line-number prefix and uniqueness", () => {
    expect(byName.Edit!.description).toContain("line-number prefix");
    expect(byName.Edit!.description).toMatch(/FAILS if old_string is not unique/);
  });

  it("Bash steers toward the dedicated tools", () => {
    expect(byName.Bash!.description).toContain("NOT `find`");
    expect(byName.Bash!.description).toMatch(/Parallel vs sequential/);
  });

  it("Glob warns against passing the literal undefined/null and points multi-round search to Task", () => {
    expect(byName.Glob!.description).toContain("do NOT pass");
    expect(byName.Glob!.description).toContain("Task");
  });

  it("Grep forbids shelling out to grep/rg", () => {
    expect(byName.Grep!.description).toMatch(/NEVER invoke `grep`/);
  });

  it("no built-in description leaks a vendor brand", () => {
    for (const tool of builtinTools()) {
      expect(tool.description).not.toMatch(/\b(Claude|Anthropic|ChatGPT|OpenAI|Gemini)\b/);
    }
  });

  it("schemas still validate (no behavior change to the contract)", () => {
    for (const tool of builtinTools()) {
      expect(tool.inputSchema).toHaveProperty("type", "object");
      expect(typeof tool.description).toBe("string");
    }
  });
});
