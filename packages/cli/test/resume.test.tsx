/**
 * Regression tests for the scrollback rendering: (1) resuming a second
 * conversation must REPLACE the screen, not stack on top of the first; (2) the
 * painted transcript is bounded so a long session can't blow the render up.
 * Both are why we dropped Ink's <Static> (append-only + unbounded fullStaticOutput).
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
} from "@coding-agent/core";
import type { ModelGateway, ModelResponse, SessionState } from "@coding-agent/core";
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
const DOWN = "[B";

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

describe("resume replaces the screen (no stacking)", () => {
  it("resuming session B after session A shows only B's transcript", async () => {
    const store = new InMemorySessionStore(new FixedClock(1000));
    // Index 0 (first created) = A; index 1 = B (list() ties on updatedAt -> insertion order).
    const a = await store.create({ id: "sA", model: "m", title: "alpha chat", cwd: "/" });
    a.messages = [{ role: "user", content: "ALPHA_MARKER_ONE" }];
    await store.save(a);
    const b = await store.create({ id: "sB", model: "m", title: "bravo chat", cwd: "/" });
    b.messages = [{ role: "user", content: "BRAVO_MARKER_TWO" }];
    await store.save(b);

    const { lastFrame, stdin, unmount } = render(<App runtime={makeRuntime(store)} effort="low" />);
    await new Promise((r) => setTimeout(r, 60));

    // First resume -> index 0 (alpha).
    stdin.write("/resume");
    await settle();
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("alpha chat"));
    stdin.write("\r"); // pick index 0
    await waitFor(() => (lastFrame() ?? "").includes("ALPHA_MARKER_ONE"));

    // Second resume -> navigate to index 1 (bravo).
    stdin.write("/resume");
    await settle();
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("Resume a conversation"));
    await settle();
    stdin.write(DOWN); // move to index 1
    await settle();
    stdin.write("\r"); // pick bravo
    await waitFor(() => (lastFrame() ?? "").includes("BRAVO_MARKER_TWO"));

    const frame = lastFrame() ?? "";
    expect(frame).toContain("BRAVO_MARKER_TWO");
    expect(frame).not.toContain("ALPHA_MARKER_ONE"); // the first transcript is gone, not stacked
    unmount();
  });
});

describe("scrollback is bounded (truncation)", () => {
  it("paints a finite window and shows an 'earlier messages hidden' marker", async () => {
    const store = new InMemorySessionStore(new FixedClock(1000));
    const s = await store.create({ id: "long", model: "m", title: "long chat", cwd: "/" });
    const msgs: SessionState["messages"] = [{ role: "user", content: "FIRST_ITEM_MARKER" }];
    for (let i = 0; i < 58; i++) msgs.push({ role: "user", content: `filler line ${i}` });
    msgs.push({ role: "user", content: "LAST_ITEM_MARKER" }); // 60 messages total
    s.messages = msgs;
    await store.save(s);
    const initial = await makeRuntime(store).getSession("long");

    const { lastFrame, unmount } = render(<App runtime={makeRuntime(store)} effort="low" initialSession={initial} />);
    await new Promise((r) => setTimeout(r, 60));

    const frame = lastFrame() ?? "";
    expect(frame).toContain("LAST_ITEM_MARKER"); // newest item is visible
    expect(frame).toMatch(/earlier message/); // truncation indicator present
    expect(frame).not.toContain("FIRST_ITEM_MARKER"); // oldest item scrolled out of the window
    unmount();
  });
});

describe("resume is scoped to the current project", () => {
  it("listSessions returns only sessions whose cwd matches the workspace root", async () => {
    const store = new InMemorySessionStore(new FixedClock(1000));
    const here = await store.create({ id: "here", model: "m", title: "this project", cwd: "/" });
    here.messages = [{ role: "user", content: "x" }];
    await store.save(here);
    const elsewhere = await store.create({ id: "elsewhere", model: "m", title: "another project", cwd: "/somewhere/else" });
    elsewhere.messages = [{ role: "user", content: "y" }];
    await store.save(elsewhere);

    // makeRuntime uses InMemoryWorkspace, rooted at "/".
    const sessions = await makeRuntime(store).listSessions();
    expect(sessions.map((s) => s.id)).toEqual(["here"]);
  });
});
