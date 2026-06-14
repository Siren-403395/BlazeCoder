/**
 * The managed credential store: `~/.blazecoder/config.json`. This REPLACES the old
 * hand-edited `.env` files. Onboarding (the TUI gate and `blazecoder --setup`) and
 * `install.sh` write it; `loadConfig` reads it. The user never edits it by hand.
 *
 * Shape (versioned for forward migrations):
 *   {
 *     "version": 1,
 *     "provider": "deepseek",          // active provider id
 *     "model": "deepseek-v4-pro",      // active model id
 *     "providers": {                   // per-provider creds, so switching keeps each key
 *       "deepseek": { "apiKey": "sk-…", "baseUrl": "https://api.deepseek.com" }
 *     }
 *   }
 *
 * The file is written 0600 (owner read/write only) since it holds an API key.
 */

import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const AUTH_CONFIG_VERSION = 1;

export interface StoredProviderCreds {
  apiKey: string;
  /** Set only when the user overrode the provider's default endpoint. */
  baseUrl?: string;
}

export interface AuthConfig {
  version: number;
  /** Active provider id (which backend to use). */
  provider?: string;
  /** Active model id within that provider. */
  model?: string;
  /** Per-provider credentials, keyed by provider id. */
  providers: Record<string, StoredProviderCreds>;
}

/** Path to the managed config file under the home dir. */
export function authConfigPath(home: string): string {
  return join(home, "config.json");
}

function emptyConfig(): AuthConfig {
  return { version: AUTH_CONFIG_VERSION, providers: {} };
}

/** Load the managed config, returning an empty (but valid) one when absent or unreadable. */
export function loadAuthConfig(home: string): AuthConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(authConfigPath(home), "utf8"));
  } catch {
    return emptyConfig();
  }
  if (!parsed || typeof parsed !== "object") return emptyConfig();
  const obj = parsed as Partial<AuthConfig>;
  return {
    version: typeof obj.version === "number" ? obj.version : AUTH_CONFIG_VERSION,
    provider: typeof obj.provider === "string" ? obj.provider : undefined,
    model: typeof obj.model === "string" ? obj.model : undefined,
    providers: obj.providers && typeof obj.providers === "object" ? (obj.providers as AuthConfig["providers"]) : {},
  };
}

/**
 * Persist the managed config. Writes a 0600 temp file then atomically renames it over
 * the target, so there is never a window where the key sits in a world-readable file
 * and a crash can't leave a torn write. The home dir is locked to 0700 too, so other
 * users can't even see that a config exists.
 */
export function saveAuthConfig(home: string, config: AuthConfig): void {
  const path = authConfigPath(home);
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  // Best-effort on platforms without POSIX modes (e.g. some Windows setups).
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* ignore */
  }
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    /* ignore */
  }
  renameSync(tmp, path); // atomic on the same filesystem; preserves the 0600 mode
}

/**
 * Record a provider's credentials and make it (and the chosen model) active. The
 * one call onboarding makes: load, set, save. Returns the updated config.
 */
export function setActiveProvider(
  home: string,
  providerId: string,
  creds: StoredProviderCreds,
  model: string,
): AuthConfig {
  const config = loadAuthConfig(home);
  const next: AuthConfig = {
    ...config,
    version: AUTH_CONFIG_VERSION,
    provider: providerId,
    model,
    providers: { ...config.providers, [providerId]: creds },
  };
  saveAuthConfig(home, next);
  return next;
}
