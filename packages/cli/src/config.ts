/**
 * Configuration for the CLI: model provider + runtime caps + where session and
 * memory state live. Sources, lowest priority first: a .env file in the cwd, then
 * the real process environment. A richer layered config file lands in Phase 3;
 * this is the minimum the runtime needs to boot.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface CliConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  maxTurns: number;
  maxBudgetUsd: number;
  contextTokens: number;
  /** Max transient-failure retries per model call. */
  maxRetries: number;
  /** Root dir for sessions + memories + global config (~/.zephyrcode by default). */
  home: string;
  /** Use the offline stub gateway instead of a real provider. */
  fakeModel: boolean;
}

/** Parse a .env file's KEY=VALUE lines into a record (no interpolation). */
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

/** The state/config dir (~/.zephyrcode), from the env or the default. */
function resolveHome(): string {
  return resolve(process.env.ZEPHYRCODE_HOME ?? process.env.CODING_AGENT_HOME ?? join(homedir(), ".zephyrcode"));
}

/**
 * Layered environment, lowest precedence first:
 *   global ~/.zephyrcode/.env  <  cwd/.env  <  real process.env
 * The install script writes the API key once into the global file; a project may
 * override it with a local .env, and the live environment always wins.
 */
function readEnv(cwd: string, home: string): Record<string, string | undefined> {
  return { ...loadDotenv(join(home, ".env")), ...loadDotenv(join(cwd, ".env")), ...process.env };
}

function num(value: string | undefined, fallback: number): number {
  const n = value === undefined ? NaN : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(cwd: string = process.cwd()): CliConfig {
  const home = resolveHome();
  const env = readEnv(cwd, home);
  return {
    apiKey: env.DEEPSEEK_API_KEY ?? "",
    model: env.DEEPSEEK_MODEL ?? "deepseek-v4-pro",
    baseUrl: env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    maxTurns: num(env.AGENT_MAX_TURNS, 24),
    maxBudgetUsd: num(env.AGENT_MAX_BUDGET_USD, 1),
    contextTokens: num(env.AGENT_CONTEXT_TOKENS, 65536),
    maxRetries: num(env.AGENT_MAX_RETRIES, 8),
    home,
    fakeModel: env.AGENT_FAKE_MODEL === "1" || env.AGENT_FAKE_MODEL === "true",
  };
}
