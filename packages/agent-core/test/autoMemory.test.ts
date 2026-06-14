import { describe, expect, it } from "vitest";
import {
  createAgentRuntime,
  FixedClock,
  InMemoryMemoryStore,
  InMemorySessionStore,
  InMemoryWorkspace,
  loadMemoryIndex,
  MEMORY_INDEX_PATH,
  silentLogger,
} from "../src/index";
import { reply, ScriptedGateway } from "./fakes";

describe("loadMemoryIndex", () => {
  it("returns the index body with a recall footer when MEMORY.md exists", async () => {
    const m = new InMemoryMemoryStore();
    await m.create(MEMORY_INDEX_PATH, "- alpha: the build uses pnpm\n- beta: see notes/auth.md");
    const out = await loadMemoryIndex(m);
    expect(out).toContain("- alpha: the build uses pnpm");
    expect(out).toContain("Recalled automatically");
  });

  it("returns empty string when there is no index yet (a no-op feature)", async () => {
    expect(await loadMemoryIndex(new InMemoryMemoryStore())).toBe("");
  });

  it("clips an oversized index", async () => {
    const m = new InMemoryMemoryStore();
    await m.create(MEMORY_INDEX_PATH, "x".repeat(9000));
    const out = await loadMemoryIndex(m);
    expect(out).toContain("index truncated");
    expect(out.length).toBeLessThan(4300);
  });
});

describe("MemoryStore.read", () => {
  it("returns raw content (no line numbers) or null", async () => {
    const m = new InMemoryMemoryStore();
    await m.create("/memories/a.md", "raw\ncontent");
    expect(await m.read("/memories/a.md")).toBe("raw\ncontent");
    expect(await m.read("/memories/missing.md")).toBeNull();
  });
});

describe("passive auto-memory injection (end-to-end)", () => {
  async function projectRulesFor(seed?: string): Promise<string> {
    const clock = new FixedClock(1);
    const gw = new ScriptedGateway("m", [reply("done", [])]);
    const memory = new InMemoryMemoryStore();
    if (seed) await memory.create(MEMORY_INDEX_PATH, seed);
    const rt = createAgentRuntime({
      gateway: gw,
      sessionStore: new InMemorySessionStore(clock),
      memory,
      workspace: new InMemoryWorkspace(),
      clock,
      logger: silentLogger,
    });
    await rt.run({ prompt: "hi" }, () => {}, new AbortController().signal);
    // projectRules is prepended as the first synthetic user message (sessionContext.assembleRequest).
    const first = gw.lastRequest!.messages[0]!;
    return first.role === "user" ? first.content : "";
  }

  it("injects the memory index into the per-turn projectRules", async () => {
    const rules = await projectRulesFor("- recall me: zephyrcode is the product name");
    expect(rules).toContain("## Memory (recalled from past sessions)");
    expect(rules).toContain("recall me: zephyrcode is the product name");
  });

  it("omits the Memory section entirely when there is no index", async () => {
    const rules = await projectRulesFor();
    expect(rules).not.toContain("## Memory");
  });
});
