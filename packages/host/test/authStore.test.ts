import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AUTH_CONFIG_VERSION,
  authConfigPath,
  loadAuthConfig,
  saveAuthConfig,
  setActiveProvider,
} from "../src/authStore";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "zc-auth-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("authStore (managed config.json)", () => {
  it("returns an empty, valid config when none exists", () => {
    const c = loadAuthConfig(home);
    expect(c.version).toBe(AUTH_CONFIG_VERSION);
    expect(c.providers).toEqual({});
    expect(c.provider).toBeUndefined();
  });

  it("round-trips a config and locks the file to 0600", () => {
    saveAuthConfig(home, {
      version: 1,
      provider: "deepseek",
      model: "deepseek-v4-pro",
      providers: { deepseek: { apiKey: "sk-1", baseUrl: "https://api.deepseek.com" } },
    });
    const c = loadAuthConfig(home);
    expect(c.provider).toBe("deepseek");
    expect(c.model).toBe("deepseek-v4-pro");
    expect(c.providers.deepseek!.apiKey).toBe("sk-1");
    expect(statSync(authConfigPath(home)).mode & 0o777).toBe(0o600); // file: owner-only
    expect(statSync(home).mode & 0o777).toBe(0o700); // dir: not even listable by others
  });

  it("setActiveProvider stores creds + makes it active, preserving other providers", () => {
    saveAuthConfig(home, { version: 1, providers: { gemini: { apiKey: "g-key" } } });
    const next = setActiveProvider(home, "deepseek", { apiKey: "sk-2" }, "deepseek-v4-pro");
    expect(next.provider).toBe("deepseek");
    expect(next.model).toBe("deepseek-v4-pro");
    expect(next.providers.deepseek!.apiKey).toBe("sk-2");
    expect(next.providers.gemini!.apiKey).toBe("g-key"); // untouched
    // persisted, not just returned
    expect(loadAuthConfig(home).providers.deepseek!.apiKey).toBe("sk-2");
  });

  it("tolerates corrupt JSON without throwing", () => {
    writeFileSync(authConfigPath(home), "{ not valid json");
    expect(loadAuthConfig(home).providers).toEqual({});
  });
});
