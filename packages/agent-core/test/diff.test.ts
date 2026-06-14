import { describe, expect, it } from "vitest";
import { computeFileDiff } from "../src/index";
import type { DiffLine } from "@blazecoder/shared";

/** Flatten all hunk lines for easy assertions. */
function lines(before: string, after: string, op: Parameters<typeof computeFileDiff>[2] = "edit", opts = {}) {
  const diff = computeFileDiff(before, after, op, opts);
  const all: DiffLine[] = diff.hunks.flatMap((h) => h.lines);
  return { diff, all };
}

describe("computeFileDiff", () => {
  it("diffs a single changed line in the middle with surrounding context", () => {
    const { diff, all } = lines("l1\nl2\nl3\nl4\nl5", "l1\nl2\nX\nl4\nl5");
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.hunks).toHaveLength(1);
    const del = all.find((l) => l.kind === "del")!;
    const add = all.find((l) => l.kind === "add")!;
    expect(del).toMatchObject({ text: "l3", oldLine: 3 });
    expect(add).toMatchObject({ text: "X", newLine: 3 });
    // Context lines carry both side numbers and surround the change.
    expect(all.some((l) => l.kind === "context" && l.text === "l2" && l.oldLine === 2 && l.newLine === 2)).toBe(true);
    expect(all.some((l) => l.kind === "context" && l.text === "l4")).toBe(true);
  });

  it("treats a brand-new file as all additions (create)", () => {
    const { diff, all } = lines("", "a\nb\nc", "create");
    expect(diff.op).toBe("create");
    expect(diff.added).toBe(3);
    expect(diff.removed).toBe(0);
    expect(all.every((l) => l.kind === "add")).toBe(true);
    expect(all.map((l) => l.newLine)).toEqual([1, 2, 3]);
    expect(all.every((l) => l.oldLine === undefined)).toBe(true);
  });

  it("counts a pure append as one addition", () => {
    const { diff } = lines("a\nb", "a\nb\nc");
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(0);
  });

  it("counts a deleted line as a removal", () => {
    const { diff, all } = lines("a\nb\nc", "a\nc");
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(1);
    expect(all.find((l) => l.kind === "del")).toMatchObject({ text: "b", oldLine: 2 });
  });

  it("splits distant changes into separate hunks (collapsed gap)", () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i + 1}`).join("\n");
    // Change line 2 and line 19 — far apart, so the unchanged middle collapses.
    const after = before.replace("l2", "X").replace("l19", "Y");
    const { diff } = lines(before, after);
    expect(diff.added).toBe(2);
    expect(diff.removed).toBe(2);
    expect(diff.hunks).toHaveLength(2);
  });

  it("returns an empty diff for identical content", () => {
    const { diff } = lines("same\ncontent", "same\ncontent");
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
    expect(diff.hunks).toHaveLength(0);
  });

  it("respects the maxLines budget and flags truncation", () => {
    const before = Array.from({ length: 100 }, (_, i) => `a${i}`).join("\n");
    const after = Array.from({ length: 100 }, (_, i) => `b${i}`).join("\n");
    const diff = computeFileDiff(before, after, "edit", { maxLines: 20 });
    // The tally reflects the WHOLE change even though hunks were capped.
    expect(diff.added).toBe(100);
    expect(diff.removed).toBe(100);
    expect(diff.truncated).toBe(true);
    expect(diff.hunks.flatMap((h) => h.lines).length).toBeLessThanOrEqual(20);
  });

  it("falls back to a coarse block diff for very large changes (no LCS blowup)", () => {
    // 520 distinct lines on each side → middle product (>250k cells) trips the coarse path.
    const before = Array.from({ length: 520 }, (_, i) => `a${i}`).join("\n");
    const after = Array.from({ length: 520 }, (_, i) => `b${i}`).join("\n");
    const diff = computeFileDiff(before, after, "edit");
    expect(diff.added).toBe(520);
    expect(diff.removed).toBe(520);
    expect(diff.truncated).toBe(true); // capped to the render budget
  });
});
