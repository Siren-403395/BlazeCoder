import { describe, expect, it } from "vitest";
import { LOADING_WORDS, TIPS, loadingWord, tipAt } from "../src/tui/flavor";

describe("loading verbs", () => {
  it("picks an in-bounds word for any seed/step (incl. negative)", () => {
    expect(loadingWord(0, 0)).toBe(LOADING_WORDS[0]);
    expect(LOADING_WORDS).toContain(loadingWord(5, 12));
    expect(LOADING_WORDS).toContain(loadingWord(-3, 999));
  });

  it("advances the verb as the step grows", () => {
    expect(loadingWord(0, 0)).not.toBe(loadingWord(0, 1));
  });
});

describe("tips", () => {
  it("wraps within the tip pool", () => {
    expect(TIPS).toContain(tipAt(0));
    expect(tipAt(0)).toBe(tipAt(TIPS.length));
    expect(TIPS).toContain(tipAt(123));
  });
});
