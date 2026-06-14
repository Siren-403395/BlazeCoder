import { describe, expect, it } from "vitest";
import type { ModelRequest } from "@zephyrcode/core";
import { StubGateway } from "../src/index";

function request(prompt: string): ModelRequest {
  return {
    system: "sys",
    messages: [{ role: "user", content: prompt }],
    tools: [],
  };
}

describe("StubGateway (offline model)", () => {
  it("echoes the latest user prompt and makes no tool calls", async () => {
    const gw = new StubGateway();
    expect(gw.model).toBe("stub-model");
    const res = await gw.complete(request("build me a thing"));
    expect(res.toolCalls).toHaveLength(0);
    expect(res.stopReason).toBe("end_turn");
    expect(res.text).toContain("build me a thing");
    expect(res.costUsd).toBe(0);
  });

  it("reads the most recent user message when there are several", async () => {
    const gw = new StubGateway();
    const res = await gw.complete({
      system: "sys",
      tools: [],
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "ok", toolCalls: [] },
        { role: "user", content: "second" },
      ],
    });
    expect(res.text).toContain("second");
    expect(res.text).not.toContain("first");
  });
});
