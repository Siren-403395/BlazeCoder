/**
 * Scrollback rendering. Committed transcript lines go to <Static> (printed once, into the
 * terminal's native history — no repaint, no flicker, scrollable). On /resume the view
 * wipes the screen (CLEAR escape) and re-keys <Static> so the resumed transcript REPLACES
 * the old one rather than stacking. (ink-testing-library accumulates Static output in
 * lastFrame and does not interpret the clear escape, so "replaces" is verified by the
 * emitted clear sequence + the re-key/epoch bump in state.test, not by string absence.)
 */

import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import {
  createAgentRuntime,
  FixedClock,
  InMemoryMemoryStore,
  InMemorySessionStore,
  InMemoryWorkspace,
  silentLogger,
} from "@zephyrcode/core";
import type { ModelGateway, ModelResponse, SessionState } from "@zephyrcode/core";
import { App } from "../src/index";

class StubGW implements ModelGateway {
  readonly model = "stub";
  async complete(): Promise<ModelResponse> {
    return { text: "ok", toolCalls: [], stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0 };
  }
}

async function waitFor(fn: () => boolean, timeout = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("waitFor timed out");
}

const settle = () => new Promise((r) => setTimeout(r, 40));
const DOWN = "\u001b[B";
const CLEAR = "[2J"; // the clear-screen escape the view emits on resume/clear

function makeRuntime(store: InMemorySessionStore) {
  return createAgentRuntime({
    gateway: new StubGW(),
    sessionStore: store,
    memory: new InMemoryMemoryStore(),
    workspace: new InMemoryWorkspace(),
    clock: new FixedClock(1000),
    logger: silentLogger,
  });
}

describe("resume replaces the screen (clear + re-keyed Static, no stacking)", () => {
  it("renders the resumed transcript and clears the screen so it replaces the previous one", async () => {
    const store = new InMemorySessionStore(new FixedClock(1000));
    const a = await store.create({ id: "sA", model: "m", title: "alpha chat", cwd: "/" });
    a.messages = [{ role: "user", content: "ALPHA_MARKER_ONE" }];
    await store.save(a);
    const b = await store.create({ id: "sB", model: "m", title: "bravo chat", cwd: "/" });
    b.messages = [{ role: "user", content: "BRAVO_MARKER_TWO" }];
    await store.save(b);

    const { lastFrame, frames, stdin, unmount } = render(<App runtime={makeRuntime(store)} effort="low" />);
    await new Promise((r) => setTimeout(r, 60));

    // First resume → index 0 (alpha).
    stdin.write("/resume");
    await settle();
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("alpha chat"));
    stdin.write("\r"); // pick index 0
    await waitFor(() => (lastFrame() ?? "").includes("ALPHA_MARKER_ONE"));

    // Second resume → navigate to index 1 (bravo).
    stdin.write("/resume");
    await settle();
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("Resume a conversation"));
    await settle();
    stdin.write(DOWN); // move to index 1
    await settle();
    stdin.write("\r"); // pick bravo
    await waitFor(() => (lastFrame() ?? "").includes("BRAVO_MARKER_TWO"));

    expect(lastFrame() ?? "").toContain("BRAVO_MARKER_TWO");
    // The screen was wiped on resume (so the prior transcript is gone visually, not stacked).
    expect(frames.some((f) => f.includes(CLEAR))).toBe(true);
    unmount();
  });
});

describe("scrollback commits to native history (Static), with a bounded initial print", () => {
  it("hydrate prints the transcript and caps the initial dump to the most recent items", async () => {
    const store = new InMemorySessionStore(new FixedClock(1000));
    const s = await store.create({ id: "long", model: "m", title: "long chat", cwd: "/" });
    // 250 messages > the hydrate cap (200), so the very first is dropped from the initial print.
    const msgs: SessionState["messages"] = [{ role: "user", content: "FIRST_ITEM_MARKER" }];
    for (let i = 0; i < 248; i++) msgs.push({ role: "user", content: `filler line ${i}` });
    msgs.push({ role: "user", content: "LAST_ITEM_MARKER" });
    s.messages = msgs;
    await store.save(s);
    const initial = await makeRuntime(store).getSession("long");

    const { lastFrame, unmount } = render(<App runtime={makeRuntime(store)} effort="low" initialSession={initial} />);
    await new Promise((r) => setTimeout(r, 60));

    const frame = lastFrame() ?? "";
    expect(frame).toContain("LAST_ITEM_MARKER"); // newest item is printed
    expect(frame).not.toContain("FIRST_ITEM_MARKER"); // oldest scrolled past the initial-print cap
    unmount();
  });
});
