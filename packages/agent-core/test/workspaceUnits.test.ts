import { describe, expect, it } from "vitest";
import { compileIgnore, isIgnored, ReadLedger } from "../src/index";

describe("gitignore matcher", () => {
  it("matches a slash-free pattern at any depth", () => {
    const rules = compileIgnore(["*.log"]);
    expect(isIgnored("a.log", false, rules)).toBe(true);
    expect(isIgnored("deep/dir/b.log", false, rules)).toBe(true);
    expect(isIgnored("a.txt", false, rules)).toBe(false);
  });

  it("anchors a pattern that starts with a slash to the root", () => {
    const rules = compileIgnore(["/build"]);
    expect(isIgnored("build", true, rules)).toBe(true);
    expect(isIgnored("build/out.js", false, rules)).toBe(true);
    expect(isIgnored("src/build", true, rules)).toBe(false);
  });

  it("honors directory-only rules", () => {
    const rules = compileIgnore(["dist/"]);
    expect(isIgnored("dist", true, rules)).toBe(true);
    expect(isIgnored("dist/app.js", false, rules)).toBe(true);
    expect(isIgnored("dist", false, rules)).toBe(false); // a file named dist is not ignored
  });

  it("applies negation with last-match-wins", () => {
    const rules = compileIgnore(["*.log", "!keep.log"]);
    expect(isIgnored("a.log", false, rules)).toBe(true);
    expect(isIgnored("keep.log", false, rules)).toBe(false);
  });

  it("supports ** across directories", () => {
    const rules = compileIgnore(["**/temp"]);
    expect(isIgnored("temp", true, rules)).toBe(true);
    expect(isIgnored("a/b/temp", true, rules)).toBe(true);
  });

  it("skips comments and blank lines", () => {
    const rules = compileIgnore(["# a comment", "", "  ", "*.tmp"]);
    expect(rules).toHaveLength(1);
    expect(isIgnored("x.tmp", false, rules)).toBe(true);
  });
});

describe("ReadLedger", () => {
  it("records, reads, and forgets stamps", () => {
    const led = new ReadLedger();
    expect(led.has("/a")).toBe(false);
    led.record("/a", { mtimeMs: 10, size: 5 });
    expect(led.has("/a")).toBe(true);
    expect(led.get("/a")).toEqual({ mtimeMs: 10, size: 5 });
    led.forget("/a");
    expect(led.has("/a")).toBe(false);
  });

  it("detects staleness by mtime or size change", () => {
    const led = new ReadLedger();
    led.record("/a", { mtimeMs: 10, size: 5 });
    expect(led.isStale("/a", { mtimeMs: 10, size: 5 })).toBe(false);
    expect(led.isStale("/a", { mtimeMs: 11, size: 5 })).toBe(true);
    expect(led.isStale("/a", { mtimeMs: 10, size: 6 })).toBe(true);
    // An unrecorded path is never "stale" (the read-before-edit check handles absence).
    expect(led.isStale("/missing", { mtimeMs: 1, size: 1 })).toBe(false);
  });
});
