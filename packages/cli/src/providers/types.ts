/**
 * The model-PROVIDER abstraction. A Provider is everything the CLI needs to (a)
 * present a model choice during onboarding and (b) build a live ModelGateway for
 * it. Each concrete provider (DeepSeek today; Gemini / Claude / … later) ships its
 * own ModelGateway adapter, so every wire-level difference — auth header, base
 * URL, request body, streaming format, tool-call schema, reasoning field — is
 * encapsulated behind `createGateway`. The registry, onboarding, and config layer
 * are entirely provider-agnostic: adding a provider is one file + one registry line.
 */

import type { ModelGateway } from "@zephyrcode/core";

/** A single selectable model and its window/output sizing. */
export interface ModelOption {
  /** Wire id sent to the API (e.g. "deepseek-v4-pro"). */
  id: string;
  /** Human label shown in the picker (e.g. "DeepSeek V4 Pro"). */
  label: string;
  /** Context window the model supports — drives the budget gauge + compaction. */
  contextTokens: number;
  /** Hard ceiling on output tokens per request. */
  maxOutputTokens: number;
  /** The model pre-selected during onboarding when the user doesn't choose. */
  default?: boolean;
}

/** The secret + endpoint a gateway needs. */
export interface ProviderCredentials {
  apiKey: string;
  /** Override the provider's default base URL (rare). */
  baseUrl?: string;
}

/** Per-build options threaded into a gateway at construction. */
export interface GatewayBuildOptions {
  /** The selected model id. */
  model: string;
  /** Max transient-failure retries per model call. */
  maxRetries?: number;
}

export interface Provider {
  /** Stable id persisted in config + used for env overrides (e.g. "deepseek"). */
  id: string;
  /** Human label shown in onboarding (e.g. "DeepSeek"). */
  label: string;
  /** Env var that overrides the stored API key (the CI / power-user escape hatch). */
  apiKeyEnv: string;
  /** Env var that overrides the stored base URL, when the provider has one. */
  baseUrlEnv?: string;
  /** Default API base URL. */
  defaultBaseUrl: string;
  /** One-line hint on the key-entry step: where to get a key + its expected shape. */
  keyHint: string;
  /** Selectable models in this build. */
  models: ModelOption[];
  /**
   * Cheap, offline shape check run before any network call. Returns a short error
   * message to show the user, or null when the key looks structurally OK.
   */
  validateKey(key: string): string | null;
  /** Construct a live ModelGateway for this provider. */
  createGateway(creds: ProviderCredentials, opts: GatewayBuildOptions): ModelGateway;
}

/** The model a provider pre-selects (its `default`, else the first one). */
export function defaultModel(provider: Provider): ModelOption {
  return provider.models.find((m) => m.default) ?? provider.models[0]!;
}

/** Look up a model by id within a provider. */
export function findModel(provider: Provider, id: string): ModelOption | undefined {
  return provider.models.find((m) => m.id === id);
}
