/**
 * Configuration for the CLI: which model PROVIDER + model to drive, the runtime
 * caps, and where session/memory state lives.
 *
 * Credentials come from the MANAGED config file (~/.blazecoder/config.json), written
 * by onboarding — the TUI first-run gate, `blazecoder --setup`, or install.sh — never
 * by hand. There are no `.env` files anymore: the only override is the real process
 * environment (the provider's own key var, e.g. DEEPSEEK_API_KEY, plus the AGENT_*
 * caps), which always wins so CI and power users can inject values without a file.
 *
 *   managed config.json   <   process.env
 */

import { cpSync, existsSync, readFileSync } from "node:fs";
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
  /** Tool-use turn cap; undefined = unlimited (only set via AGENT_MAX_TURNS). */
  maxTurns?: number;
  /** $ cost cap; undefined = unlimited (only set via AGENT_MAX_BUDGET_USD). */
  maxBudgetUsd?: number;
  contextTokens: number;
  /** Optional ceiling on output tokens per request; omit to use the model's full maximum. */
  maxOutputTokens?: number;
  /** Max transient-failure retries per model call. */
  maxRetries: number;
  /** Root dir for sessions + memories + the managed config (~/.blazecoder by default). */
  home: string;
  /** Use the offline stub gateway instead of a real provider. */
  fakeModel: boolean;
  /** Enable the WebSearch/WebFetch tools (off by default). */
  webEnabled: boolean;
  /** Active output-style name (resolved against loaded output-styles), if any. */
  outputStyle?: string;
}

function num(value: string | undefined, fallback: number): number {
  const s = value?.trim();
  if (!s) return fallback; // unset OR empty/whitespace (e.g. `VAR=` in CI) → the default
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

/** Like num(), but returns undefined when unset/blank — for OPT-IN caps where absent = no cap. */
function optNum(value: string | undefined): number | undefined {
  const s = value?.trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** A trimmed env value, or undefined when unset/empty, so `??` chains fall through correctly. */
function envStr(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}

/** The state/config dir (~/.blazecoder), from the env or the default. */
function resolveHome(): string {
  return resolve(process.env.BLAZECODER_HOME ?? join(homedir(), ".blazecoder"));
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
 * One-time rescue of a key from the OLD build's global config (`~/.blazecoder/.env`,
 * the only file the previous installer wrote) into the managed config, so upgrading
 * keeps working without re-onboarding. Runs ONLY when no managed config exists yet;
 * afterwards `.env` is never read again. We deliberately do NOT read a project-local
 * `./.env`: that was a manual dev convenience, and migrating an arbitrary project's
 * `.env` into the global config would be both surprising and a small attack surface.
 */
function migrateLegacyEnv(home: string): void {
  if (existsSync(authConfigPath(home))) return;
  const legacy = loadDotenv(join(home, ".env"));
  const apiKey = (legacy.DEEPSEEK_API_KEY ?? "").trim();
  if (!apiKey) return;
  const provider = resolveProvider(undefined); // the old global .env was always DeepSeek
  const wantModel = legacy.DEEPSEEK_MODEL?.trim();
  const model = wantModel && findModel(provider, wantModel) ? wantModel : defaultModel(provider).id;
  const baseUrl = legacy.DEEPSEEK_BASE_URL?.trim();
  setActiveProvider(home, provider.id, baseUrl ? { apiKey, baseUrl } : { apiKey }, model);
}

/**
 * One-time upgrade across the product rename: if the new default state dir (~/.blazecoder)
 * does not exist yet but the previous one (~/.zephyrcode) does, copy it over so the managed
 * config (API key), sessions, memory and permission settings survive without re-onboarding.
 * Only runs for the DEFAULT home — an explicit BLAZECODER_HOME is never second-guessed.
 * Best-effort: a failed copy just falls back to first-run onboarding, never a crash.
 */
export function migrateRenamedHome(home: string, previous: string): void {
  if (process.env.BLAZECODER_HOME) return;
  if (existsSync(home) || !existsSync(previous)) return;
  try {
    cpSync(previous, home, { recursive: true });
  } catch {
    /* fall through to onboarding */
  }
}

export function loadConfig(_cwd: string = process.cwd()): CliConfig {
  const home = resolveHome();
  migrateRenamedHome(home, join(homedir(), ".zephyrcode"));
  migrateLegacyEnv(home);
  const stored = loadAuthConfig(home);
  const env = process.env;

  // Provider: env override → stored → registry default. Empty env strings fall through.
  const provider = resolveProvider(envStr(env.BLAZECODER_PROVIDER) ?? stored.provider);
  const creds = stored.providers[provider.id];

  // Key/baseUrl: a non-empty provider env var wins, else the stored value. (An empty
  // env var must NOT shadow the stored key, or a configured user gets re-onboarded.)
  const apiKey = (envStr(env[provider.apiKeyEnv]) ?? creds?.apiKey ?? "").trim();
  const baseUrl =
    (provider.baseUrlEnv ? envStr(env[provider.baseUrlEnv]) : undefined) ?? creds?.baseUrl ?? provider.defaultBaseUrl;

  // Model: env override → stored → provider default; sizing comes from the model.
  const wantModel = envStr(env.BLAZECODER_MODEL) ?? stored.model ?? defaultModel(provider).id;
  const model = findModel(provider, wantModel) ?? defaultModel(provider);

  return {
    providerId: provider.id,
    apiKey,
    model: model.id,
    baseUrl,
    // Off by default — a coding agent shouldn't be throttled mid-project. Set the env var to opt in.
    maxTurns: optNum(env.AGENT_MAX_TURNS),
    maxBudgetUsd: optNum(env.AGENT_MAX_BUDGET_USD),
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
