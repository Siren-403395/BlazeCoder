import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import {
  createAgentRuntime,
  FixedClock,
  InMemoryMemoryStore,
  InMemorySessionStore,
  InMemoryWorkspace,
  silentLogger,
} from "@coding-agent/core";
import type { ModelGateway, ModelResponse } from "@coding-agent/core";
import { App } from "../src/index";

class StubGW implements ModelGateway {
  readonly model = "stub";
  async complete(): Promise<ModelResponse> {
    return { text: "ok", toolCalls: [], stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0 };
  }
}

function makeRuntime(store = new InMemorySessionStore(new FixedClock(1000))) {
  return createAgentRuntime({
    gateway: new StubGW(),
    sessionStore: store,
    memory: new InMemoryMemoryStore(),
    workspace: new InMemoryWorkspace(),
    clock: new FixedClock(1000),
    logger: silentLogger,
  });
}

async function waitFor(fn: () => boolean, timeout = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("waitFor timed out");
}

describe("command palette (interactive)", () => {
  it("shows prefix-filtered commands with descriptions as you type", async () => {
    const { lastFrame, stdin, unmount } = render(<App runtime={makeRuntime()} effort="low" />);
    await new Promise((r) => setTimeout(r, 60));
    stdin.write("/e");
    await waitFor(() => (lastFrame() ?? "").includes("/effort"));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("/effort");
    expect(frame).toContain("Set reasoning effort");
    expect(frame).toContain("/exit");
    expect(frame).not.toContain("/resume"); // filtered out by the "e" prefix
    unmount();
  });

  it("shows the argument placeholder after completing a command with a space", async () => {
    const { lastFrame, stdin, unmount } = render(<App runtime={makeRuntime()} effort="low" />);
    await new Promise((r) => setTimeout(r, 60));
    stdin.write("/effort ");
    await waitFor(() => (lastFrame() ?? "").includes("low | medium | high | ultra"));
    unmount();
  });
});

describe("/resume picker (interactive)", () => {
  it("lists a saved session, then hydrates its transcript on select", async () => {
    const store = new InMemorySessionStore(new FixedClock(1000));
    const sess = await store.create({ id: "s1", model: "m", title: "earlier chat", cwd: "/w" });
    sess.messages = [
      { role: "user", content: "hello from history" },
      { role: "assistant", content: "hi back", toolCalls: [] },
    ];
    sess.turns = 1;
    await store.save(sess);

    const { lastFrame, stdin, unmount } = render(<App runtime={makeRuntime(store)} effort="low" />);
    await new Promise((r) => setTimeout(r, 60));

    stdin.write("/resume");
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("\r"); // run /resume → opens the picker (async listSessions)
    await waitFor(() => (lastFrame() ?? "").includes("earlier chat"));
    expect(lastFrame() ?? "").toContain("Resume a conversation");

    stdin.write("\r"); // pick the highlighted session → hydrate (async getSession)
    await waitFor(() => (lastFrame() ?? "").includes("hello from history"));
    expect(lastFrame() ?? "").toContain("hi back");
    unmount();
  });
});
