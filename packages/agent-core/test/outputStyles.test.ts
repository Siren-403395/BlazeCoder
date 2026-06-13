import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentRuntime,
  FixedClock,
  InMemoryMemoryStore,
  InMemorySessionStore,
  InMemoryWorkspace,
  loadOutputStyles,
  outputStyleOptions,
  silentLogger,
} from "../src/index";
import { reply, ScriptedGateway } from "./fakes";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "zc-styles-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("loadOutputStyles + outputStyleOptions", () => {
  it("loads a style (name from frontmatter or filename) and appends by default", () => {
    const dir = tmp();
    writeFileSync(join(dir, "terse.md"), "---\nname: terse\ndescription: very brief\n---\nAlways answer in one sentence.");
    const [style] = loadOutputStyles([dir]);
    expect(style!.name).toBe("terse");
    expect(outputStyleOptions(style)).toEqual({ extraInstructions: "Always answer in one sentence." });
  });

  it("keepCodingInstructions:false makes the style an override", () => {
    const dir = tmp();
    writeFileSync(join(dir, "poet.md"), "---\nname: poet\nkeepCodingInstructions: false\n---\nRespond only in haiku.");
    const [style] = loadOutputStyles([dir]);
    expect(outputStyleOptions(style)).toEqual({ system: "Respond only in haiku." });
  });
});

describe("an output style reshapes the assembled system prompt", () => {
  async function systemFor(opts: { extraInstructions?: string; system?: string }) {
    const clock = new FixedClock(1);
    const gw = new ScriptedGateway("m", [reply("done", [])]);
    const rt = createAgentRuntime({
      gateway: gw,
      sessionStore: new InMemorySessionStore(clock),
      memory: new InMemoryMemoryStore(),
      workspace: new InMemoryWorkspace(),
      clock,
      logger: silentLogger,
      ...opts,
    });
    await rt.run({ prompt: "hi" }, () => {}, new AbortController().signal);
    return gw.lastRequest!.system;
  }

  it("appends extraInstructions as an Additional instructions section", async () => {
    const sys = await systemFor({ extraInstructions: "STYLE_MARKER: be terse" });
    expect(sys).toContain("## Additional instructions\nSTYLE_MARKER: be terse");
    expect(sys).toContain("You are zephyrcode"); // base prompt still present
  });

  it("a system override replaces the base prompt", async () => {
    const sys = await systemFor({ system: "OVERRIDE_ONLY" });
    expect(sys).toContain("OVERRIDE_ONLY");
    expect(sys).not.toContain("# Doing tasks");
  });
});
