import { describe, expect, it } from "vitest";
import { EFFORTS, escalateFromPrompt, isEffort, resolveEffort } from "../src/index";

describe("resolveEffort (maps to DeepSeek-V4-Pro's three native modes)", () => {
  it("has exactly three levels", () => {
    expect(EFFORTS).toEqual(["low", "high", "ultra"]);
  });

  it("low = Non-think (thinking off, no budget)", () => {
    const r = resolveEffort("low");
    expect(r.thinking).toBe(false);
    expect(r.budget).toBeUndefined();
  });

  it("high = Think High (budget 'high')", () => {
    const r = resolveEffort("high");
    expect(r.thinking).toBe(true);
    expect(r.budget).toBe("high");
  });

  it("ultra = Think Max (budget 'max')", () => {
    const r = resolveEffort("ultra");
    expect(r.thinking).toBe(true);
    expect(r.budget).toBe("max");
  });

  it("raises the output-token guard up the ladder", () => {
    const base = 8000;
    expect(resolveEffort("low", base).maxOutputTokens).toBe(base);
    expect(resolveEffort("high", base).maxOutputTokens).toBeGreaterThan(base);
    expect(resolveEffort("ultra", base).maxOutputTokens).toBeGreaterThan(resolveEffort("high", base).maxOutputTokens);
  });

  it("defaults to high", () => {
    expect(resolveEffort().budget).toBe("high");
  });
});

describe("escalateFromPrompt", () => {
  it("bumps the turn to ultra on a think-hard keyword, overriding the sticky level", () => {
    expect(escalateFromPrompt("ultrathink this please", "low")).toBe("ultra");
    expect(escalateFromPrompt("please think harder about it", "high")).toBe("ultra");
    expect(escalateFromPrompt("think step by step", "low")).toBe("ultra");
  });

  it("keeps the sticky level when there is no keyword", () => {
    expect(escalateFromPrompt("build me a counter", "high")).toBe("high");
    expect(escalateFromPrompt("rethinking the layout", "low")).toBe("low"); // not a whole-word match
  });
});

describe("isEffort", () => {
  it("validates effort strings", () => {
    expect(isEffort("ultra")).toBe(true);
    expect(isEffort("high")).toBe(true);
    expect(isEffort("medium")).toBe(false); // dropped — only three levels now
    expect(isEffort("zoom")).toBe(false);
  });
});
