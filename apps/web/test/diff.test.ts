import { describe, expect, it } from "vitest";
import { diffLines, diffStats } from "@/lib/diff";

describe("diffLines", () => {
  it("marks a single changed line as del + add around stable lines", () => {
    const rows = diffLines("a\nb\nc", "a\nx\nc");
    expect(rows.map((r) => r.type)).toEqual(["same", "del", "add", "same"]);
    expect(diffStats(rows)).toEqual({ added: 1, removed: 1 });
  });

  it("handles pure insertion and deletion", () => {
    expect(diffLines("", "a").map((r) => r.type)).toEqual(["add"]);
    expect(diffLines("a", "").map((r) => r.type)).toEqual(["del"]);
  });

  it("reports no change for identical content", () => {
    const rows = diffLines("x\ny", "x\ny");
    expect(rows.every((r) => r.type === "same")).toBe(true);
    expect(diffStats(rows)).toEqual({ added: 0, removed: 0 });
  });

  it("tracks line numbers on the correct side", () => {
    const rows = diffLines("a", "b");
    expect(rows[0]).toMatchObject({ type: "del", before: 1 });
    expect(rows[1]).toMatchObject({ type: "add", after: 1 });
  });
});
