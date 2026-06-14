import { describe, expect, it } from "vitest";
import type { ModelRequest } from "@blazecoder/core";
import { buildDeepSeekBody } from "../src/adapters/deepseekGateway";

function req(over: Partial<ModelRequest> = {}): ModelRequest {
  return { system: "sys", messages: [{ role: "user", content: "hi" }], tools: [], ...over };
}

describe("buildDeepSeekBody (effort -> DeepSeek-V4-Pro thinking knobs)", () => {
  it("low / no thinking: sends temperature, no thinking field", () => {
    const body = buildDeepSeekBody("deepseek-v4-pro", req({ thinking: false, temperature: 0.2 }), false);
    expect(body.thinking).toBeUndefined();
    expect(body.temperature).toBe(0.2);
  });

  it("high: thinking enabled with native budget 'high', and no temperature", () => {
    const body = buildDeepSeekBody("m", req({ thinking: true, thinkingBudget: "high" }), false);
    expect(body.thinking).toEqual({ type: "enabled", budget: "high" });
    expect(body.temperature).toBeUndefined();
  });

  it("ultra: thinking enabled with native budget 'max'", () => {
    const body = buildDeepSeekBody("m", req({ thinking: true, thinkingBudget: "max" }), false);
    expect(body.thinking).toEqual({ type: "enabled", budget: "max" });
  });

  it("thinking with no budget falls back to a bare enabled flag", () => {
    const body = buildDeepSeekBody("m", req({ thinking: true }), false);
    expect(body.thinking).toEqual({ type: "enabled" });
  });

  it("carries model, max_tokens, and streaming options", () => {
    const body = buildDeepSeekBody("deepseek-v4-pro", req({ maxOutputTokens: 12000 }), true);
    expect(body.model).toBe("deepseek-v4-pro");
    expect(body.max_tokens).toBe(12000);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });
});
