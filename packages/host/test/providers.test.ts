import { describe, expect, it } from "vitest";
import { DeepSeekGateway } from "../src/index";
import {
  DEFAULT_PROVIDER_ID,
  defaultModel,
  deepseekProvider,
  findModel,
  getProvider,
  PROVIDERS,
  resolveProvider,
} from "../src/providers";

describe("provider registry", () => {
  it("ships DeepSeek as the default provider", () => {
    expect(DEFAULT_PROVIDER_ID).toBe("deepseek");
    expect(PROVIDERS.map((p) => p.id)).toContain("deepseek");
    expect(getProvider("deepseek")).toBe(deepseekProvider);
    expect(getProvider("nope")).toBeUndefined();
  });

  it("resolveProvider falls back to the default for unknown / empty ids", () => {
    expect(resolveProvider("deepseek").id).toBe("deepseek");
    expect(resolveProvider("does-not-exist").id).toBe("deepseek");
    expect(resolveProvider(undefined).id).toBe("deepseek");
  });

  it("exposes the V4 Pro model with 1M context / 384K output as the default", () => {
    const m = defaultModel(deepseekProvider);
    expect(m.id).toBe("deepseek-v4-pro");
    expect(m.contextTokens).toBe(1_048_576);
    expect(m.maxOutputTokens).toBe(384_000);
    expect(findModel(deepseekProvider, "deepseek-v4-pro")?.label).toBe("DeepSeek V4 Pro");
    expect(findModel(deepseekProvider, "nope")).toBeUndefined();
  });

  it("validateKey rejects empty / wrong-prefix / too-short, accepts a real-shaped key", () => {
    expect(deepseekProvider.validateKey("")).toBeTruthy();
    expect(deepseekProvider.validateKey("   ")).toBeTruthy();
    expect(deepseekProvider.validateKey("nope-no-prefix")).toBeTruthy();
    expect(deepseekProvider.validateKey("sk-short")).toBeTruthy();
    expect(deepseekProvider.validateKey(`sk-${"a".repeat(40)}`)).toBeNull();
  });

  it("createGateway builds a DeepSeekGateway for the chosen model + default base URL", () => {
    const gw = deepseekProvider.createGateway({ apiKey: "sk-test" }, { model: "deepseek-v4-pro", maxRetries: 3 });
    expect(gw).toBeInstanceOf(DeepSeekGateway);
    expect(gw.model).toBe("deepseek-v4-pro");
  });
});
