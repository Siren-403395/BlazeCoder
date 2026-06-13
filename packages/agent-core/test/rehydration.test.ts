import { describe, expect, it } from "vitest";
import { buildPostCompactFileMessage, InMemoryWorkspace, ReadLedger } from "../src/index";
import type { TranscriptMessage } from "../src/index";

const stamp = { mtimeMs: 1, size: 1 };
/** Narrow the restored message (always a user message) to its text. */
const text = (m: TranscriptMessage | null): string => (m && m.role === "user" ? m.content : "");

describe("ReadLedger recency", () => {
  it("recentlyReadPaths is most-recent-first and de-duplicated on re-read", async () => {
    const led = new ReadLedger();
    led.record("/a.ts", stamp);
    led.record("/b.ts", stamp);
    led.record("/a.ts", { mtimeMs: 2, size: 2 }); // re-read a → now most recent
    expect(led.recentlyReadPaths()).toEqual(["/a.ts", "/b.ts"]);
    expect(led.recentlyReadPaths(1)).toEqual(["/a.ts"]);
  });

  it("clear() forgets everything", () => {
    const led = new ReadLedger();
    led.record("/a.ts", stamp);
    led.clear();
    expect(led.recentlyReadPaths()).toEqual([]);
  });
});

async function seed() {
  const ws = new InMemoryWorkspace();
  await ws.write({ path: "/x.ts", language: "ts", content: "X".repeat(100) });
  await ws.write({ path: "/y.ts", language: "ts", content: "Y".repeat(100) });
  const led = new ReadLedger();
  led.record("/x.ts", (await ws.stat("/x.ts"))!);
  led.record("/y.ts", (await ws.stat("/y.ts"))!); // y most recent
  return { ws, led };
}

describe("buildPostCompactFileMessage", () => {
  it("re-reads the recently-read files into a single restored-context user message", async () => {
    const { ws, led } = await seed();
    const msg = await buildPostCompactFileMessage(led, ws, []);
    expect(msg?.role).toBe("user");
    expect(text(msg)).toContain("Restored file context after compaction");
    expect(text(msg)).toContain('<file path="/x.ts">');
    expect(text(msg)).toContain('<file path="/y.ts">');
  });

  it("honors the file limit, most-recent first", async () => {
    const { ws, led } = await seed();
    const msg = await buildPostCompactFileMessage(led, ws, [], { limit: 1 });
    expect(text(msg)).toContain("/y.ts"); // most recent
    expect(text(msg)).not.toContain("/x.ts");
  });

  it("head-truncates a file beyond perFileChars", async () => {
    const { ws, led } = await seed();
    const msg = await buildPostCompactFileMessage(led, ws, [], { perFileChars: 10 });
    expect(text(msg)).toContain("…[truncated]");
  });

  it("skips a file whose content is still present verbatim in the kept tail", async () => {
    const { ws, led } = await seed();
    const tail: TranscriptMessage[] = [{ role: "user", content: `X`.repeat(100) }];
    const msg = await buildPostCompactFileMessage(led, ws, tail);
    expect(text(msg)).not.toContain("/x.ts"); // already in the tail
    expect(text(msg)).toContain("/y.ts");
  });

  it("returns null when there is nothing to restore", async () => {
    const ws = new InMemoryWorkspace();
    const led = new ReadLedger();
    expect(await buildPostCompactFileMessage(led, ws, [])).toBeNull();
  });
});
