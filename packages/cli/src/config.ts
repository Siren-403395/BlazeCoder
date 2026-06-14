/**
 * Configuration for the CLI: which model PROVIDER + model to drive, the runtime
 * caps, and where session/memory state lives.
 *
 * Credentials come from the MANAGED config file (~/.zephyrcode/config.json), written
 * by onboarding — the TUI first-run gate, `zephyrcode --setup`, or install.sh — never
 * by hand. There are no `.env` files anymore: the only override is the real process
 * environment (the provider's own key var, e.g. DEEPSEEK_API_KEY, plus the AGENT_*
 * caps), which always wins so CI and power users can inject values without a file.
 *
 *   managed config.json   <   process.env
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { authConfigPath, loadAuthConfig, setActiveProvider } from "./authStore";
import { defaultModel, findModel, resolveProvider } from "./providers";

export interface CliConfig {
  /** Active provider id (e.g. "deepseek"). */
  providerId: string;
  apiKey: string;
  /** Active model id. */
  model: string;
  baseUrl: string;
  maxTurns: number;
  maxBudgetUsd: number;
  contextTokens: number;
  /** Optional ceiling on output tokens per request; omit to use the model's full maximum. */
  maxOutputTokens?: number;
  /** Max transient-failure retries per model call. */
  maxRetries: number;
  /** Root dir for sessions + memories + the managed config (~/.zephyrcode by default). */
  home: string;
  /** Use the offline stub gateway instead of a real provider. */
  fakeModel: boolean;
  /** Enable the WebSearch/WebFetch tools (off by default). */
  webEnabled: boolean;
  /** Active output-style name (resolved against loaded output-styles), if any. */
  outputStyle?: string;
}

function num(value: string | undefined, fallback: number): number {
  const n = value === undefined ? NaN : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** The state/config dir (~/.zephyrcode), from the env or the default. */
function resolveHome(): string {
  return resolve(process.env.ZEPHYRCODE_HOME ?? process.env.CODING_AGENT_HOME ?? join(homedir(), ".zephyrcode"));
}

/** Parse a legacy .env file's KEY=VALUE lines (migration only — we no longer use .env). */
function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadDotenv(path: string): Record<string, string> {
  try {
    return parseDotenv(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/**
 * One-time rescue of a key from the OLD `.env` form into the managed config, so an
 * existing install keeps working after the switch. Runs only when no managed config
 * exists yet; afterwards `.env` is never read again. (We retired .env config; this
 * just migrates the user's existing key so onboarding doesn't re-prompt needlessly.)
 */
function migrateLegacyEnv(home: string, cwd: string): void {
  if (existsSync(authConfigPath(home))) return;
  const legacy = { ...loadDotenv(join(home, ".env")), ...loadDotenv(join(cwd, ".env")) };
  const apiKey = (legacy.DEEPSEEK_API_KEY ?? "").trim();
  if (!apiKey) return;
  const provider = resolveProvider(undefined); // legacy .env was always DeepSeek
  const wantModel = legacy.DEEPSEEK_MODEL?.trim();
  const model = wantModel && findModel(provider, wantModel) ? wantModel : defaultModel(provider).id;
  const baseUrl = legacy.DEEPSEEK_BASE_URL?.trim();
  setActiveProvider(home, provider.id, baseUrl ? { apiKey, baseUrl } : { apiKey }, model);
}

export function loadConfig(cwd: string = process.cwd()): CliConfig {
  const home = resolveHome();
  migrateLegacyEnv(home, cwd);
  const stored = loadAuthConfig(home);
  const env = process.env;

  // Provider: env override → stored → registry default.
  const provider = resolveProvider(env.ZEPHYRCODE_PROVIDER ?? stored.provider);
  const creds = stored.providers[provider.id];

  // Key/baseUrl: the provider's own env var always wins, else the stored value.
  const apiKey = (env[provider.apiKeyEnv] ?? creds?.apiKey ?? "").trim();
  const baseUrl =
    (provider.baseUrlEnv ? env[provider.baseUrlEnv] : undefined) ?? creds?.baseUrl ?? provider.defaultBaseUrl;

  // Model: env override → stored → provider default; sizing comes from the model.
  const wantModel = env.ZEPHYRCODE_MODEL ?? stored.model ?? defaultModel(provider).id;
  const model = findModel(provider, wantModel) ?? defaultModel(provider);

  return {
    providerId: provider.id,
    apiKey,
    model: model.id,
    baseUrl,
    maxTurns: num(env.AGENT_MAX_TURNS, 24),
    maxBudgetUsd: num(env.AGENT_MAX_BUDGET_USD, 1),
    contextTokens: num(env.AGENT_CONTEXT_TOKENS, model.contextTokens),
    // Default to the model's full maximum; AGENT_MAX_OUTPUT_TOKENS caps it lower.
    maxOutputTokens: num(env.AGENT_MAX_OUTPUT_TOKENS, model.maxOutputTokens),
    maxRetries: num(env.AGENT_MAX_RETRIES, 8),
    home,
    fakeModel: env.AGENT_FAKE_MODEL === "1" || env.AGENT_FAKE_MODEL === "true",
    webEnabled: env.AGENT_WEB === "1" || env.AGENT_WEB === "true",
    outputStyle: env.AGENT_OUTPUT_STYLE || undefined,
  };
}
