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
    expect(sys).toContain("You are blazecoder"); // base prompt still present
  });

  it("a system override replaces the base prompt", async () => {
    const sys = await systemFor({ system: "OVERRIDE_ONLY" });
    expect(sys).toContain("OVERRIDE_ONLY");
    expect(sys).not.toContain("# Doing tasks");
  });
});

describe("runtime output-style switching (takes effect next run)", () => {
  const TERSE = { name: "terse", description: "brief", prompt: "STYLE_TERSE: one sentence" };
  const POET = { name: "poet", description: "haiku", prompt: "STYLE_POET: only haiku", keepCodingInstructions: false };

  function makeRuntimeWithStyles(active?: string) {
    const clock = new FixedClock(1);
    const gw = new ScriptedGateway("m", [reply("a", []), reply("b", []), reply("c", [])]);
    const rt = createAgentRuntime({
      gateway: gw,
      sessionStore: new InMemorySessionStore(clock),
      memory: new InMemoryMemoryStore(),
      workspace: new InMemoryWorkspace(),
      clock,
      logger: silentLogger,
      outputStyles: [TERSE, POET],
      outputStyle: active,
    });
    const systemAfterRun = async () => {
      await rt.run({ prompt: "hi" }, () => {}, new AbortController().signal);
      return gw.lastRequest!.system;
    };
    return { rt, systemAfterRun };
  }

  it("activates the startup style and exposes the available styles", async () => {
    const { rt, systemAfterRun } = makeRuntimeWithStyles("terse");
    expect(rt.outputStyles.map((s) => s.name)).toEqual(["terse", "poet"]);
    expect(rt.outputStyle).toBe("terse");
    expect(await systemAfterRun()).toContain("## Additional instructions\nSTYLE_TERSE: one sentence");
  });

  it("switching to an override style replaces the base prompt on the next run", async () => {
    const { rt, systemAfterRun } = makeRuntimeWithStyles();
    expect(await systemAfterRun()).toContain("You are blazecoder"); // no style yet
    rt.setOutputStyle(POET);
    expect(rt.outputStyle).toBe("poet");
    const sys = await systemAfterRun();
    expect(sys).toContain("STYLE_POET: only haiku");
    expect(sys).not.toContain("# Doing tasks"); // override drops the base sections
  });

  it("clearing the style reverts to the base prompt", async () => {
    const { rt, systemAfterRun } = makeRuntimeWithStyles("terse");
    rt.setOutputStyle(undefined);
    expect(rt.outputStyle).toBeUndefined();
    const sys = await systemAfterRun();
    expect(sys).toContain("You are blazecoder");
    expect(sys).not.toContain("STYLE_TERSE");
  });
});
