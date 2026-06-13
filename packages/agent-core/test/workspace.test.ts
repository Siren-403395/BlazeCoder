import { describe, expect, it } from "vitest";
import { emptyProject } from "@coding-agent/shared";
import { InMemoryWorkspace } from "../src/index";

describe("InMemoryWorkspace", () => {
  it("writes, reads, lists, deletes and snapshots", () => {
    const ws = new InMemoryWorkspace(emptyProject("demo"));
    expect(ws.list()).toHaveLength(0);

    ws.write({ path: "/src/App.tsx", language: "tsx", content: "a" });
    ws.write({ path: "/src/b.ts", language: "ts", content: "b" });
    expect(ws.list()).toHaveLength(2);
    expect(ws.read("/src/App.tsx")?.content).toBe("a");
    expect(ws.exists("/src/b.ts")).toBe(true);

    expect(ws.delete("/src/b.ts")).toBe(true);
    expect(ws.delete("/missing")).toBe(false);
    expect(ws.list()).toHaveLength(1);

    const snap = ws.snapshot();
    expect(snap.projectName).toBe("demo");
    expect(snap.files.map((f) => f.path)).toEqual(["/src/App.tsx"]);
  });

  it("returns copies (no external mutation of internal state)", () => {
    const ws = new InMemoryWorkspace(emptyProject("demo"));
    ws.write({ path: "/a.ts", language: "ts", content: "x" });
    const read = ws.read("/a.ts")!;
    read.content = "mutated";
    expect(ws.read("/a.ts")?.content).toBe("x");
  });
});
