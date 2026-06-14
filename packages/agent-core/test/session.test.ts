import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSessionStore, FixedClock, InMemorySessionStore } from "../src/index";

describe("InMemorySessionStore", () => {
  it("creates, saves, gets and lists sessions", async () => {
    const clock = new FixedClock(1000);
    const store = new InMemorySessionStore(clock);

    const s = await store.create({ id: "a", model: "m", title: "t", cwd: "/work" });
    expect(s.id).toBe("a");
    expect(s.createdAt).toBe(1000);
    expect(s.status).toBe("idle");

    clock.set(2000);
    s.turns = 3;
    await store.save(s);

    const got = await store.get("a");
    expect(got?.turns).toBe(3);
    expect(got?.updatedAt).toBe(2000);

    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe("a");
    expect(await store.get("missing")).toBeUndefined();
  });

  it("isolates stored state from later mutation of the returned object", async () => {
    const store = new InMemorySessionStore(new FixedClock());
    const s = await store.create({ id: "a", model: "m", title: "t", cwd: "/work" });
    s.turns = 99;
    const got = await store.get("a");
    expect(got?.turns).toBe(0);
  });
});

describe("FileSessionStore durability", () => {
  it("lists the valid sessions even when one file is corrupt (a kill must not lose all)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zc-sess-"));
    const store = new FileSessionStore(dir, new FixedClock(1000));
    await store.create({ id: "a", model: "m", title: "Alpha", cwd: "/w" });
    await store.create({ id: "b", model: "m", title: "Beta", cwd: "/w" });
    // A half-written file, as a hard kill mid-save would leave behind.
    writeFileSync(join(dir, "sessions", "c.json"), "{ truncated json with no clos");

    const list = await store.list();
    // The corrupt file is skipped; the others survive (the old code returned [] for all).
    expect(list.map((s) => s.id).sort()).toEqual(["a", "b"]);
  });

  it("saves atomically — content is intact and no .tmp residue is left", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zc-sess-"));
    const store = new FileSessionStore(dir, new FixedClock(1000));
    const s = await store.create({ id: "a", model: "m", title: "t", cwd: "/w" });
    s.turns = 5;
    await store.save(s);

    expect((await store.get("a"))?.turns).toBe(5);
    expect(readdirSync(join(dir, "sessions"))).toEqual(["a.json"]); // temp file was renamed away
  });

  it("sweeps an orphaned temp file from a crashed process while still listing valid sessions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zc-sess-"));
    const store = new FileSessionStore(dir, new FixedClock(1000));
    await store.create({ id: "a", model: "m", title: "A", cwd: "/w" });
    const sdir = join(dir, "sessions");
    writeFileSync(join(sdir, "b.json.99999.tmp"), "half written"); // a dead process's residue

    const list = await store.list();
    expect(list.map((s) => s.id)).toEqual(["a"]); // listing is unaffected
    await new Promise((r) => setTimeout(r, 30)); // the sweep is fire-and-forget
    expect(readdirSync(sdir)).toEqual(["a.json"]); // orphan reclaimed
  });
});
