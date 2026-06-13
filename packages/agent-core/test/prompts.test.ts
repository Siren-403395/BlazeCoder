import { describe, expect, it } from "vitest";
import { ALL_TOOL_NAMES, builtinTools, buildSubagentPrompt, buildSystemPrompt, PRODUCT_NAME, TOOL_NAMES } from "../src/index";

const realToolNames = () => new Set(builtinTools().map((t) => t.name));
const render = (over: Partial<Parameters<typeof buildSystemPrompt>[0]> = {}) =>
  buildSystemPrompt({ toolNames: realToolNames(), ...over }).join("\n\n");

describe("system prompt identity", () => {
  it("uses the product name as the first, swappable section", () => {
    expect(PRODUCT_NAME).toBe("zephyrcode");
    const sections = buildSystemPrompt({ toolNames: realToolNames() });
    expect(sections[0]).toContain("You are zephyrcode");
    expect(sections[0]).toContain("## Identity");
  });

  it("forbids claiming a foundation-model vendor identity", () => {
    const p = render();
    expect(p).toMatch(/Do not claim to be Claude/);
    expect(p).toContain("DeepSeek");
  });

  it("never names a model vendor OUTSIDE the identity-denial line", () => {
    const p = render();
    for (const line of p.split("\n")) {
      if (/\b(Claude|Anthropic|DeepSeek|ChatGPT|Gemini|OpenAI)\b/.test(line)) {
        // The only place a vendor brand may appear is the identity denial.
        expect(line).toMatch(/Do not claim to be|identity as a product/);
      }
    }
  });
});

describe("ported counterweight prose (anchors survive rendering)", () => {
  const anchors = [
    "Before reporting a task complete",
    'Never claim "all tests pass"',
    "reversibility and blast radius",
    "does NOT mean they approve it in all contexts",
    "Three similar lines of code beat a premature abstraction",
    "Do not propose changes to code you haven't read",
    "one question per response",
    "file_path:line_number",
    "Do not use a colon immediately before a tool call",
  ];
  for (const a of anchors) {
    it(`contains: ${a.slice(0, 40)}…`, () => {
      expect(render()).toContain(a);
    });
  }
});

describe("using-tools section gates on the registered tools", () => {
  it("references tools through TOOL_NAMES and prefers them over shell equivalents", () => {
    const p = render();
    expect(p).toContain(`${TOOL_NAMES.read} over cat/head/tail`);
    expect(p).toContain(`${TOOL_NAMES.glob} over find`);
    expect(p).toContain(`Reserve ${TOOL_NAMES.bash}`);
  });

  it("omits the bash steer when Bash is not registered", () => {
    const p = buildSystemPrompt({ toolNames: new Set([TOOL_NAMES.read, TOOL_NAMES.grep]) }).join("\n\n");
    expect(p).not.toContain(`Reserve ${TOOL_NAMES.bash}`);
    expect(p).toContain(TOOL_NAMES.grep); // search steer still present
  });

  it("drops the whole using-tools section when no tools are registered", () => {
    const p = buildSystemPrompt({ toolNames: new Set() }).join("\n\n");
    expect(p).not.toContain("# Using your tools");
  });
});

describe("guard: every tool name in the prompt exists in the registry", () => {
  it("mentions no legacy/ghost tool names", () => {
    const p = render();
    for (const ghost of ["read_file", "write_file", "edit_file", "list_files", "delete_file", "run_command"]) {
      expect(p).not.toContain(ghost);
    }
  });

  it("every canonical name that appears in the prompt is a registered name", () => {
    const registered = realToolNames();
    const p = render();
    for (const name of ALL_TOOL_NAMES) {
      if (new RegExp(`\\b${name}\\b`).test(p)) expect(registered.has(name)).toBe(true);
    }
  });
});

describe("override and subagent variants", () => {
  it("override replaces the whole prompt", () => {
    const p = buildSystemPrompt({ toolNames: realToolNames(), override: "CUSTOM ONLY" });
    expect(p[0]).toBe("CUSTOM ONLY");
    expect(p.join("\n")).not.toContain("# Doing tasks");
  });

  it("extra is appended as an Additional instructions section", () => {
    expect(render({ extra: "Project rule X" })).toContain("## Additional instructions\nProject rule X");
  });

  it("subagent variant keeps identity but uses the sub-agent contract", () => {
    const p = buildSubagentPrompt({ toolNames: realToolNames() }).join("\n\n");
    expect(p).toContain("You are zephyrcode");
    expect(p).toContain("# You are a sub-agent");
    expect(p).toContain("absolute file paths");
    expect(p).not.toContain("# Doing tasks");
  });
});
