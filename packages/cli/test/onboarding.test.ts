import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAuthConfig } from "../src/authStore";
import { needsOnboarding, runHeadlessSetup, type SetupIo } from "../src/onboarding";
import type { CliConfig } from "../src/config";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "zc-onb-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** A scripted IO: answers are dealt in order; `null` once they run out (EOF). */
function scriptedIo(answers: string[], env: Record<string, string> = {}): { io: SetupIo; out: () => string } {
  const written: string[] = [];
  let i = 0;
  const io: SetupIo = {
    write: (t) => written.push(t),
    ask: async () => (i < answers.length ? answers[i++]! : null),
    env: env as NodeJS.ProcessEnv,
  };
  return { io, out: () => written.join("") };
}

const cfg = (over: Partial<CliConfig>): CliConfig =>
  ({ apiKey: "", fakeModel: false, ...over } as CliConfig);

describe("needsOnboarding", () => {
  it("is true only when there is no key and no offline-stub mode", () => {
    expect(needsOnboarding(cfg({ apiKey: "" }))).toBe(true);
    expect(needsOnboarding(cfg({ apiKey: "sk-1" }))).toBe(false);
    expect(needsOnboarding(cfg({ apiKey: "", fakeModel: true }))).toBe(false);
  });
});

describe("runHeadlessSetup", () => {
  it("with one provider/model, prompts only for the key and saves a valid one", async () => {
    const key = `sk-${"a".repeat(40)}`;
    const { io } = scriptedIo([key]);
    const res = await runHeadlessSetup(home, io);
    expect(res).toEqual({ saved: true, providerId: "deepseek", model: "deepseek-v4-pro" });
    const stored = loadAuthConfig(home);
    expect(stored.providers.deepseek!.apiKey).toBe(key);
    expect(stored.provider).toBe("deepseek");
  });

  it("uses the provider's env key non-interactively (no prompt needed)", async () => {
    const key = `sk-${"b".repeat(40)}`;
    const { io } = scriptedIo([], { DEEPSEEK_API_KEY: key });
    const res = await runHeadlessSetup(home, io);
    expect(res.saved).toBe(true);
    expect(loadAuthConfig(home).providers.deepseek!.apiKey).toBe(key);
  });

  it("re-prompts after a malformed key, then accepts a valid one", async () => {
    const good = `sk-${"c".repeat(40)}`;
    const { io, out } = scriptedIo(["bad-key", good]);
    const res = await runHeadlessSetup(home, io);
    expect(res.saved).toBe(true);
    expect(out()).toMatch(/Try again/);
    expect(loadAuthConfig(home).providers.deepseek!.apiKey).toBe(good);
  });

  it("skips on a blank key and writes nothing", async () => {
    const { io } = scriptedIo([""]);
    const res = await runHeadlessSetup(home, io);
    expect(res.saved).toBe(false);
    expect(existsSync(join(home, "config.json"))).toBe(false);
  });

  it("skips gracefully when no input is available (EOF)", async () => {
    const { io } = scriptedIo([]);
    const res = await runHeadlessSetup(home, io);
    expect(res.saved).toBe(false);
    expect(existsSync(join(home, "config.json"))).toBe(false);
  });
});
