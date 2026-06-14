import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitChanges } from "../src/git";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zc-git-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("gitChanges (/changes)", () => {
  it("reports an honest fallback when the directory is not a git repo", async () => {
    const r = await gitChanges(dir);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Not a git repository/);
  });

  it("reports a clean working tree for a fresh repo with no changes", async () => {
    execFileSync("git", ["-C", dir, "init", "-q"]);
    const r = await gitChanges(dir);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/working tree is clean/);
  });

  it("surfaces changed/untracked paths and a discard hint", async () => {
    execFileSync("git", ["-C", dir, "init", "-q"]);
    writeFileSync(join(dir, "notes.txt"), "hello\n");
    const r = await gitChanges(dir);
    expect(r.ok).toBe(true);
    expect(r.message).toContain("notes.txt"); // the untracked file shows in `git status --short`
    expect(r.message).toMatch(/git restore -p|git checkout -p/); // the selective-discard pointer
  });
});
