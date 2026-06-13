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

// ink-testing-library needs a render tick to settle before a follow-up key (e.g. Tab)
// is processed; in a real terminal there is always a natural gap between keystrokes.
const settle = () => new Promise((r) => setTimeout(r, 40));

// Strip SGR codes so substring assertions don't trip over Ink's color escapes.
const clean = (s: string | undefined) => (s ?? "").replace(new RegExp("\\x1b\\[[0-9;]*m", "g"), "");

describe("command palette (interactive)", () => {
  it("shows prefix-filtered commands with descriptions as you type", async () => {
    const { lastFrame, stdin, unmount } = render(<App runtime={makeRuntime()} effort="low" />);
    await new Promise((r) => setTimeout(r, 60));
    stdin.write("/e");
    await waitFor(() => (lastFrame() ?? "").includes("/effort"));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("/effort");
    expect(frame).toContain("Set reasoning depth");
    expect(frame).toContain("/exit");
    expect(frame).not.toContain("/resume"); // filtered out by the "e" prefix
    unmount();
  });

  it("shows the argument placeholder after completing a command with a space", async () => {
    const { lastFrame, stdin, unmount } = render(<App runtime={makeRuntime()} effort="low" />);
    await new Promise((r) => setTimeout(r, 60));
    stdin.write("/effort ");
    await waitFor(() => (lastFrame() ?? "").includes("low | high | ultra"));
    unmount();
  });
});

const UP = "\u001b[A";

describe("Tab completion + cursor placement", () => {
  it("Tab completes the command and the cursor lands after it (so the arg types correctly)", async () => {
    const { lastFrame, stdin, unmount } = render(<App runtime={makeRuntime()} effort="low" />);
    await new Promise((r) => setTimeout(r, 60));
    stdin.write("/eff");
    await waitFor(() => (lastFrame() ?? "").includes("/effort"));
    await settle();
    stdin.write("\t"); // complete -> "/effort " with the cursor at the end
    await waitFor(() => (lastFrame() ?? "").includes("low | high | ultra"));
    await settle();
    stdin.write("ultra"); // must land AFTER the space: "/effort ultra"
    await settle();
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("✶ ultra")); // input border now carries the set effort
    unmount();
  });
});

describe("command history", () => {
  it("recalls the previous submission with the Up arrow", async () => {
    const { lastFrame, stdin, unmount } = render(<App runtime={makeRuntime()} effort="low" />);
    await new Promise((r) => setTimeout(r, 60));
    stdin.write("/clear");
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\r"); // submit /clear → wipes scrollback; the input line goes empty
    await new Promise((r) => setTimeout(r, 60));
    // The prompt line is empty now. (A rotating tip may mention "/clear", so assert
    // on the input line specifically — "❯ /clear" — not the whole frame.)
    expect(clean(lastFrame())).not.toContain("❯ /clear");
    stdin.write(UP); // recall "/clear" into the input line
    await waitFor(() => clean(lastFrame()).includes("❯ /clear"));
    unmount();
  });
});

describe("@-mention file completion", () => {
  it("lists workspace files and Tab inserts the path", async () => {
    const ws = new InMemoryWorkspace();
    await ws.write({ path: "/src/App.tsx", language: "tsx", content: "x" });
    await ws.write({ path: "/README.md", language: "md", content: "x" });
    const rt = createAgentRuntime({
      gateway: new StubGW(),
      sessionStore: new InMemorySessionStore(new FixedClock(1)),
      memory: new InMemoryMemoryStore(),
      workspace: ws,
      clock: new FixedClock(1),
      logger: silentLogger,
    });
    const { lastFrame, stdin, unmount } = render(<App runtime={rt} effort="low" />);
    await new Promise((r) => setTimeout(r, 120)); // let listFiles load
    stdin.write("@App");
    await waitFor(() => (lastFrame() ?? "").includes("src/App.tsx"));
    await settle();
    stdin.write("\t"); // insert the path
    await waitFor(() => (lastFrame() ?? "").includes("@src/App.tsx"));
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
