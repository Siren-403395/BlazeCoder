import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { authConfigPath, loadAuthConfig, saveAuthConfig } from "../src/authStore";

// Every env var loadConfig consults — cleared before each test so we control inputs.
const RELEVANT = [
  "ZEPHYRCODE_HOME",
  "ZEPHYRCODE_PROVIDER",
  "ZEPHYRCODE_MODEL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "AGENT_MAX_TURNS",
  "AGENT_MAX_BUDGET_USD",
  "AGENT_CONTEXT_TOKENS",
  "AGENT_MAX_OUTPUT_TOKENS",
  "AGENT_MAX_RETRIES",
  "AGENT_FAKE_MODEL",
  "AGENT_WEB",
  "AGENT_OUTPUT_STYLE",
];

let home: string;
let cwd: string;
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "zc-cfg-home-"));
  cwd = mkdtempSync(join(tmpdir(), "zc-cfg-cwd-"));
  savedEnv = { ...process.env };
  for (const k of RELEVANT) delete process.env[k];
  process.env.ZEPHYRCODE_HOME = home;
});

afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("defaults to DeepSeek V4 Pro with no key when nothing is configured", () => {
    const c = loadConfig(cwd);
    expect(c.providerId).toBe("deepseek");
    expect(c.model).toBe("deepseek-v4-pro");
    expect(c.apiKey).toBe("");
    expect(c.baseUrl).toBe("https://api.deepseek.com");
    expect(c.contextTokens).toBe(1_048_576);
    expect(c.maxOutputTokens).toBe(384_000);
  });

  it("reads the API key from the managed config.json", () => {
    saveAuthConfig(home, {
      version: 1,
      provider: "deepseek",
      model: "deepseek-v4-pro",
      providers: { deepseek: { apiKey: "sk-stored" } },
    });
    expect(loadConfig(cwd).apiKey).toBe("sk-stored");
  });

  it("lets the provider's env var override the stored key", () => {
    saveAuthConfig(home, { version: 1, providers: { deepseek: { apiKey: "sk-stored" } } });
    process.env.DEEPSEEK_API_KEY = "sk-from-env";
    expect(loadConfig(cwd).apiKey).toBe("sk-from-env");
  });

  it("honors AGENT_CONTEXT_TOKENS as an override of the model default", () => {
    process.env.AGENT_CONTEXT_TOKENS = "200000";
    expect(loadConfig(cwd).contextTokens).toBe(200000);
  });

  it("one-time migrates an old global ~/.zephyrcode/.env key into the managed config", () => {
    writeFileSync(join(home, ".env"), "DEEPSEEK_API_KEY=sk-legacy-global\nDEEPSEEK_MODEL=deepseek-v4-pro\n");
    expect(existsSync(authConfigPath(home))).toBe(false);
    const c = loadConfig(cwd);
    expect(c.apiKey).toBe("sk-legacy-global");
    // It wrote config.json, so it never re-migrates.
    expect(existsSync(authConfigPath(home))).toBe(true);
    expect(loadAuthConfig(home).providers.deepseek!.apiKey).toBe("sk-legacy-global");
  });

  it("does NOT migrate a project-local ./.env (only the global one is a legacy source)", () => {
    writeFileSync(join(cwd, ".env"), "DEEPSEEK_API_KEY=sk-project-local\n");
    expect(loadConfig(cwd).apiKey).toBe(""); // project .env is no longer a config source
    expect(existsSync(authConfigPath(home))).toBe(false); // nothing migrated
  });

  it("does not migrate once a managed config already exists", () => {
    saveAuthConfig(home, { version: 1, providers: { deepseek: { apiKey: "sk-managed" } } });
    writeFileSync(join(home, ".env"), "DEEPSEEK_API_KEY=sk-legacy\n");
    expect(loadConfig(cwd).apiKey).toBe("sk-managed"); // legacy .env ignored
  });

  it("treats an empty/whitespace numeric env var as unset, not 0", () => {
    // Regression: `num('')` used to return 0, capping output to 0 tokens.
    process.env.AGENT_MAX_OUTPUT_TOKENS = "";
    process.env.AGENT_CONTEXT_TOKENS = "   ";
    const c = loadConfig(cwd);
    expect(c.maxOutputTokens).toBe(384_000);
    expect(c.contextTokens).toBe(1_048_576);
  });

  it("an empty DEEPSEEK_API_KEY env var does not shadow the stored key", () => {
    saveAuthConfig(home, { version: 1, providers: { deepseek: { apiKey: "sk-stored" } } });
    process.env.DEEPSEEK_API_KEY = "";
    expect(loadConfig(cwd).apiKey).toBe("sk-stored");
  });
});
