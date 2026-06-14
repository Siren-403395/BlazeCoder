/**
 * The DeepSeek provider — the one model backend shipped today. It wraps the
 * OpenAI-compatible DeepSeekGateway adapter. A future Gemini / Claude provider is
 * a sibling file with its own gateway; nothing else in the app changes.
 */

import { MODEL_MAX_OUTPUT_TOKENS } from "@zephyrcode/core";
import { DeepSeekGateway } from "../adapters/deepseekGateway";
import type { Provider } from "./types";

export const deepseekProvider: Provider = {
  id: "deepseek",
  label: "DeepSeek",
  apiKeyEnv: "DEEPSEEK_API_KEY",
  baseUrlEnv: "DEEPSEEK_BASE_URL",
  defaultBaseUrl: "https://api.deepseek.com",
  keyHint: "Create a key at https://platform.deepseek.com/api_keys — it starts with “sk-”.",
  models: [
    {
      id: "deepseek-v4-pro",
      label: "DeepSeek V4 Pro",
      // ~1M-token context window, 384K-token max output (the model's hard ceiling).
      contextTokens: 1_048_576,
      maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
      default: true,
    },
  ],
  validateKey(key) {
    const k = key.trim();
    if (!k) return "The key is empty.";
    if (!k.startsWith("sk-")) return "A DeepSeek key usually starts with “sk-”.";
    if (k.length < 20) return "That key looks too short to be valid.";
    return null;
  },
  createGateway(creds, opts) {
    return new DeepSeekGateway({
      apiKey: creds.apiKey,
      model: opts.model,
      baseUrl: creds.baseUrl ?? this.defaultBaseUrl,
      maxRetries: opts.maxRetries,
    });
  },
};
