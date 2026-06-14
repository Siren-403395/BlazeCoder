import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSessionStore, systemClock } from "@zephyrcode/core";
import { migrateLegacySessions, projectKey, projectStateDir } from "../src/projects";

const tmpDirs: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("projectKey", () => {
  it("is deterministic and unique per path", () => {
    expect(projectKey("/Users/x/a")).toBe(projectKey("/Users/x/a"));
    expect(projectKey("/Users/x/a")).not.toBe(projectKey("/Users/x/b"));
  });

  it("is readable (basename prefix) and bounded in length", () => {
    const k = projectKey("/Users/x/algo-runzo");
    expect(k.startsWith("algo-runzo-")).toBe(true);
    expect(k.length).toBeLessThan(60);
    // very deep path stays bounded (no 255-byte filename overflow)
    expect(projectKey("/a/" + "x".repeat(500)).length).toBeLessThan(60);
  });
});

describe("projectStateDir", () => {
  it("nests under <home>/projects/<key>", () => {
    expect(projectStateDir("/home", "/p/a")).toBe(join("/home", "projects", projectKey("/p/a")));
  });
});

describe("per-project session isolation (structural)", () => {
  it("a store rooted in project A never sees project B's sessions", async () => {
    const home = tmp("zc-iso-");
    const a = new FileSessionStore(projectStateDir(home, "/proj/a"), systemClock);
    const b = new FileSessionStore(projectStateDir(home, "/proj/b"), systemClock);
    await a.create({ id: "x", model: "m", title: "in A", cwd: "/proj/a" });

    expect((await a.list()).map((s) => s.id)).toEqual(["x"]);
    expect(await b.list()).toEqual([]); // B is physically a different directory
  });
});

describe("migrateLegacySessions", () => {
  it("relocates flat global sessions into per-project dirs by their cwd", async () => {
    const home = tmp("zc-mig-");
    const legacy = join(home, "sessions");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "s1.json"), JSON.stringify({ id: "s1", cwd: "/proj/alpha" }));
    writeFileSync(join(legacy, "s2.json"), JSON.stringify({ id: "s2", cwd: "/proj/beta" }));

    await migrateLegacySessions(home);

    expect(existsSync(join(projectStateDir(home, "/proj/alpha"), "sessions", "s1.json"))).toBe(true);
    expect(existsSync(join(projectStateDir(home, "/proj/beta"), "sessions", "s2.json"))).toBe(true);
    expect(existsSync(legacy)).toBe(false); // legacy dir cleaned up once empty
  });

  it("is a safe no-op when there is no legacy dir", async () => {
    const home = tmp("zc-mig2-");
    await expect(migrateLegacySessions(home)).resolves.toBeUndefined();
  });
});
