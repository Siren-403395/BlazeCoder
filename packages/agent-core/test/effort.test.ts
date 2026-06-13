import { describe, expect, it } from "vitest";
import { escalateFromPrompt, isEffort, resolveEffort } from "../src/index";

describe("resolveEffort", () => {
  it("disables thinking only at the low level", () => {
    expect(resolveEffort("low").thinking).toBe(false);
    expect(resolveEffort("medium").thinking).toBe(true);
    expect(resolveEffort("high").thinking).toBe(true);
    expect(resolveEffort("ultra").thinking).toBe(true);
  });

  it("scales the output budget up the ladder", () => {
    const base = 8000;
    expect(resolveEffort("low", base).maxOutputTokens).toBe(base);
    expect(resolveEffort("medium", base).maxOutputTokens).toBe(base);
    expect(resolveEffort("high", base).maxOutputTokens).toBeGreaterThan(base);
    expect(resolveEffort("ultra", base).maxOutputTokens).toBeGreaterThan(resolveEffort("high", base).maxOutputTokens);
  });

  it("defaults to high", () => {
    expect(resolveEffort().thinking).toBe(true);
  });
});

describe("escalateFromPrompt", () => {
  it("bumps the turn to ultra on a think-hard keyword, overriding the sticky level", () => {
    expect(escalateFromPrompt("ultrathink this please", "low")).toBe("ultra");
    expect(escalateFromPrompt("please think harder about it", "medium")).toBe("ultra");
    expect(escalateFromPrompt("think step by step", "low")).toBe("ultra");
  });

  it("keeps the sticky level when there is no keyword", () => {
    expect(escalateFromPrompt("build me a counter", "medium")).toBe("medium");
    expect(escalateFromPrompt("rethinking the layout", "low")).toBe("low"); // not a whole-word match
  });
});

describe("isEffort", () => {
  it("validates effort strings", () => {
    expect(isEffort("ultra")).toBe(true);
    expect(isEffort("zoom")).toBe(false);
  });
});
