/**
 * Deterministic, network-free ModelGateway for offline smoke runs and `ca doctor`
 * (enable with AGENT_FAKE_MODEL=1). It drives the real loop without an API key by
 * answering every prompt with a fixed, no-tool reply. Richer scripted plans for
 * end-to-end tests live in the test suite, not here.
 */

import type { ModelGateway, ModelRequest, ModelResponse } from "@zephyrcode/core";

export class StubGateway implements ModelGateway {
  readonly model = "stub-model";

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
    const prompt = lastUser && lastUser.role === "user" ? lastUser.content : "(no prompt)";
    return {
      text: `Stub model (offline). I received: ${prompt.slice(0, 200)}`,
      toolCalls: [],
      stopReason: "end_turn",
      usage: { inputTokens: 50, outputTokens: 20 },
      costUsd: 0,
    };
  }
}
