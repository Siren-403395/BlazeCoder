import { describe, expect, it } from "vitest";
import { FixedClock, InMemorySessionStore } from "../src/index";

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
