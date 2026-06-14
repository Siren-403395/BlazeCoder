/**
 * The provider registry: the single list of model backends this build can drive.
 * Onboarding, config resolution, and runtime wiring all read from here, so adding
 * a provider (Gemini, Claude, …) is exactly: write its provider file, then add it
 * to PROVIDERS below. Nothing else needs to know it exists.
 */

import { deepseekProvider } from "./deepseek";
import type { Provider } from "./types";

/** Every provider the CLI knows how to drive. The first is the default. */
export const PROVIDERS: Provider[] = [deepseekProvider];

/** The provider id used when none is configured. */
export const DEFAULT_PROVIDER_ID = PROVIDERS[0]!.id;

/** Look up a provider by id (undefined if unknown). */
export function getProvider(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** Resolve a provider id to a Provider, falling back to the default for unknown/empty ids. */
export function resolveProvider(id: string | undefined): Provider {
  return (id ? getProvider(id) : undefined) ?? PROVIDERS[0]!;
}
