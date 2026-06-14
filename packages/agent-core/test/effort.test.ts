import { describe, expect, it } from "vitest";
import { EFFORTS, escalateFromPrompt, isEffort, MODEL_MAX_OUTPUT_TOKENS, outputBudget, resolveEffort } from "../src/index";

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

  it("controls thinking depth only — it never carries an output budget", () => {
    expect(resolveEffort("low")).not.toHaveProperty("maxOutputTokens");
    expect(resolveEffort("ultra")).not.toHaveProperty("maxOutputTokens");
  });

  it("defaults to high", () => {
    expect(resolveEffort().budget).toBe("high");
  });
});

describe("outputBudget (unleash output, clamp only to fit the window)", () => {
  it("hands the model its full max when there's plenty of room", () => {
    expect(outputBudget(1_048_576, 20_000)).toBe(MODEL_MAX_OUTPUT_TOKENS); // 384k
    expect(MODEL_MAX_OUTPUT_TOKENS).toBe(384_000);
  });

  it("shrinks only when input + output would overflow the window", () => {
    // input near the top of a 1M window → budget = window − input − pad, below the model max.
    const budget = outputBudget(1_048_576, 900_000);
    expect(budget).toBeLessThan(MODEL_MAX_OUTPUT_TOKENS);
    expect(budget).toBeGreaterThan(100_000); // still huge — nowhere near the old 8k/32k caps
    expect(900_000 + budget).toBeLessThanOrEqual(1_048_576);
  });

  it("honors an explicit lower cap (e.g. for cost control)", () => {
    expect(outputBudget(1_048_576, 10_000, 50_000)).toBe(50_000);
  });

  it("never returns below a small floor even if input is enormous", () => {
    expect(outputBudget(1_048_576, 1_048_576)).toBe(1_024);
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
