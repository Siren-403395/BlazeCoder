import { describe, expect, it } from "vitest";
import { SUMMARY_INSTRUCTIONS, stripAnalysis } from "../src/index";

describe("hardened summarization prompt", () => {
  it("contains the load-bearing guards", () => {
    expect(SUMMARY_INSTRUCTIONS).toMatch(/Do NOT call any tools/);
    expect(SUMMARY_INSTRUCTIONS).toMatch(/<analysis>/);
    expect(SUMMARY_INSTRUCTIONS).toMatch(/All user messages/);
    expect(SUMMARY_INSTRUCTIONS).toMatch(/VERBATIM QUOTE/);
    expect(SUMMARY_INSTRUCTIONS).toMatch(/resum\w* directly/i);
  });
});

describe("stripAnalysis", () => {
  it("removes an <analysis> block but keeps the summary", () => {
    const out = stripAnalysis("<analysis>scratch thoughts\nmore</analysis>\n# Summary\nUser wants X.");
    expect(out).not.toContain("scratch thoughts");
    expect(out).toContain("User wants X.");
  });

  it("is a no-op when there is no analysis block", () => {
    expect(stripAnalysis("just a summary")).toBe("just a summary");
  });
});
