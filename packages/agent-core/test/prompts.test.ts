import { describe, expect, it } from "vitest";
import { CODING_AGENT_SYSTEM_PROMPT, PRODUCT_NAME, buildSystemPrompt } from "../src/prompts";

describe("system prompt identity", () => {
  it("uses the product name as the identity", () => {
    expect(PRODUCT_NAME).toBe("zephyrcode");
    expect(CODING_AGENT_SYSTEM_PROMPT).toContain("You are zephyrcode");
    expect(CODING_AGENT_SYSTEM_PROMPT).toContain("## Identity");
  });

  it("forbids claiming a foundation-model vendor identity", () => {
    // The base model leaks "I'm Claude / DeepSeek"; the prompt must override that.
    expect(CODING_AGENT_SYSTEM_PROMPT).toMatch(/Do not claim to be Claude/);
    expect(CODING_AGENT_SYSTEM_PROMPT).toContain("DeepSeek");
  });

  it("keeps the identity block when extra instructions are appended", () => {
    const built = buildSystemPrompt("project rule X");
    expect(built).toContain("You are zephyrcode");
    expect(built).toContain("project rule X");
  });
});
