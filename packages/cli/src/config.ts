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
  /** Root dir for sessions + memories (~/.coding-agent by default). */
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

/** Read environment, filling gaps from a cwd .env file (process.env wins). */
function readEnv(cwd: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  try {
    const fromFile = parseDotenv(readFileSync(join(cwd, ".env"), "utf8"));
    for (const [k, v] of Object.entries(fromFile)) if (env[k] === undefined) env[k] = v;
  } catch {
    // no .env; fine
  }
  return env;
}

function num(value: string | undefined, fallback: number): number {
  const n = value === undefined ? NaN : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(cwd: string = process.cwd()): CliConfig {
  const env = readEnv(cwd);
  return {
    apiKey: env.DEEPSEEK_API_KEY ?? "",
    model: env.DEEPSEEK_MODEL ?? "deepseek-v4-pro",
    baseUrl: env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    maxTurns: num(env.AGENT_MAX_TURNS, 24),
    maxBudgetUsd: num(env.AGENT_MAX_BUDGET_USD, 1),
    contextTokens: num(env.AGENT_CONTEXT_TOKENS, 65536),
    home: resolve(env.CODING_AGENT_HOME ?? join(homedir(), ".coding-agent")),
    fakeModel: env.AGENT_FAKE_MODEL === "1" || env.AGENT_FAKE_MODEL === "true",
  };
}
