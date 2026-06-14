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
import type { ModelGateway, ModelRequest, ModelResponse } from "@zephyrcode/core";
import type { FileDiff } from "@zephyrcode/shared";
import { App } from "../src/index";
import { ItemView } from "../src/tui/view";

class ScriptedGateway implements ModelGateway {
  readonly model = "scripted";
  calls = 0;
  constructor(private readonly steps: ModelResponse[]) {}
  async complete(_req: ModelRequest): Promise<ModelResponse> {
    const step = this.steps[Math.min(this.calls, this.steps.length - 1)]!;
    this.calls += 1;
    return step;
  }
}

function step(text: string, toolCalls: ModelResponse["toolCalls"] = []): ModelResponse {
  return { text, toolCalls, stopReason: "end_turn", usage: { inputTokens: 5, outputTokens: 5 }, costUsd: 0.0001 };
}

async function waitFor(fn: () => boolean, timeout = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("waitFor timed out");
}

describe("ItemView", () => {
  it("renders a finalized tool line with status, name, detail and summary", () => {
    const { lastFrame, unmount } = render(
      <ItemView item={{ kind: "tool", id: "c", name: "Write", status: "ok", input: { file_path: "/a.ts" }, summary: "Wrote /a.ts (1 line)." }} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Write");
    expect(frame).toContain("/a.ts");
    expect(frame).toContain("Wrote /a.ts");
    unmount();
  });

  it("renders a git-style diff block for an edited file and drops the redundant summary", () => {
    const diff: FileDiff = {
      op: "edit",
      added: 1,
      removed: 1,
      truncated: false,
      hunks: [
        {
          lines: [
            { kind: "context", text: "keep me", oldLine: 1, newLine: 1 },
            { kind: "del", text: "old line", oldLine: 2 },
            { kind: "add", text: "new line", newLine: 2 },
          ],
        },
      ],
    };
    const { lastFrame, unmount } = render(
      <ItemView item={{ kind: "tool", id: "t", name: "Edit", status: "ok", input: { file_path: "/a.ts" }, summary: "Edited /a.ts (1 replacement).", diff }} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Edit"); // the tool row
    expect(frame).toContain("- old line"); // a removed line
    expect(frame).toContain("+ new line"); // an added line
    expect(frame).toContain("+1"); // the added stat
    expect(frame).toContain("−1"); // the removed stat (unicode minus)
    expect(frame).not.toContain("1 replacement"); // the path-doubling summary is gone
    unmount();
  });

  it("keeps the textual summary for non-file tools (no diff)", () => {
    const { lastFrame, unmount } = render(
      <ItemView item={{ kind: "tool", id: "t", name: "Bash", status: "ok", input: { command: "ls" }, summary: "exit 0" }} />,
    );
    expect(lastFrame() ?? "").toContain("exit 0");
    unmount();
  });

  it("renders a finalized assistant message", () => {
    const { lastFrame, unmount } = render(
      <ItemView item={{ kind: "assistant", id: "a", text: "All set.", streaming: false }} />,
    );
    expect(lastFrame() ?? "").toContain("All set.");
    unmount();
  });

  it("renders a permission-style notice", () => {
    const { lastFrame, unmount } = render(
      <ItemView item={{ kind: "notice", id: "n", level: "warn", message: "heads up" }} />,
    );
    expect(lastFrame() ?? "").toContain("heads up");
    unmount();
  });
});

describe("welcome banner", () => {
  it("shows the logo + orientation on an empty session", async () => {
    const runtime = createAgentRuntime({
      gateway: new ScriptedGateway([step("hi")]),
      sessionStore: new InMemorySessionStore(new FixedClock(1)),
      memory: new InMemoryMemoryStore(),
      workspace: new InMemoryWorkspace(),
      clock: new FixedClock(1),
      logger: silentLogger,
    });
    const { lastFrame, unmount } = render(<App runtime={runtime} effort="high" />);
    await new Promise((r) => setTimeout(r, 80));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("█"); // the big block wordmark rendered
    expect(frame).toContain("command-line coding agent"); // tagline
    expect(frame).toContain("/help"); // orientation line
    unmount();
  });
});

describe("manual /compact command", () => {
  it("compacts the conversation on demand and shows the boundary", async () => {
    const clock = new FixedClock(1);
    const runtime = createAgentRuntime({
      gateway: new ScriptedGateway([
        step("Creating a notes file.", [{ id: "w", name: "Write", input: { file_path: "/notes.md", content: "# Notes\n" } }]),
        step("Done — created /notes.md."),
      ]),
      sessionStore: new InMemorySessionStore(clock),
      memory: new InMemoryMemoryStore(),
      workspace: new InMemoryWorkspace(),
      clock,
      logger: silentLogger,
      // Keep just the last message so a short transcript still has a head to summarize.
      compaction: { summaryKeepMinMessages: 1, summaryKeepMinTokens: 0, summaryKeepMaxTokens: 1_000_000 },
    });

    const { lastFrame, stdin, unmount } = render(<App runtime={runtime} effort="low" />);

    // Run one turn so there is a session + transcript to compact.
    await new Promise((r) => setTimeout(r, 80));
    stdin.write("make notes");
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("done"));

    // Now invoke /compact.
    stdin.write("/compact");
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("\r");

    await waitFor(() => (lastFrame() ?? "").includes("Compacted:"));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("context compacted"); // the ⟳ boundary chip rendered
    expect(frame).toContain("Compacted:"); // the precise token-delta notice

    unmount();
  });

  it("reports 'Already compact' when there is nothing to free", async () => {
    const clock = new FixedClock(1);
    const runtime = createAgentRuntime({
      gateway: new ScriptedGateway([step("Hi there.")]),
      sessionStore: new InMemorySessionStore(clock),
      memory: new InMemoryMemoryStore(),
      workspace: new InMemoryWorkspace(),
      clock,
      logger: silentLogger,
      // Default compaction window keeps the whole short transcript → nothing to summarize.
    });

    const { lastFrame, stdin, unmount } = render(<App runtime={runtime} effort="low" />);
    await new Promise((r) => setTimeout(r, 80));
    stdin.write("hello");
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("done"));

    stdin.write("/compact");
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("Already compact"));
    expect(lastFrame() ?? "").toContain("Already compact");

    unmount();
  });
});

describe("App end-to-end (scripted runtime)", () => {
  it("submits a prompt, runs a tool, and shows the result", async () => {
    const ws = new InMemoryWorkspace();
    const clock = new FixedClock(1);
    const runtime = createAgentRuntime({
      gateway: new ScriptedGateway([
        step("Creating a notes file.", [{ id: "w", name: "Write", input: { file_path: "/notes.md", content: "# Notes\n" } }]),
        step("Done — created /notes.md."),
      ]),
      sessionStore: new InMemorySessionStore(clock),
      memory: new InMemoryMemoryStore(),
      workspace: ws,
      clock,
      logger: silentLogger,
    });

    const { lastFrame, stdin, unmount } = render(<App runtime={runtime} effort="low" />);

    await new Promise((r) => setTimeout(r, 80)); // let the input mount + focus
    stdin.write("make notes");
    await new Promise((r) => setTimeout(r, 30)); // let the keystrokes land before Enter
    stdin.write("\r");

    // Wait until the scripted run has finished (the result line shows "done").
    await waitFor(() => (lastFrame() ?? "").includes("done"));

    const frame = lastFrame() ?? "";
    expect(frame).toContain("make notes"); // the user prompt landed in scrollback
    expect(frame).toContain("Write"); // the tool ran
    expect(frame).toContain("done"); // the run finished successfully
    expect((await ws.read("/notes.md"))?.content).toBe("# Notes\n"); // the file was actually written
    // End-to-end diff: the Write's create diff rode the file_change event, attached to the
    // tool row, and rendered as a block (proving tool → event → reducer → DiffBlock).
    expect(frame).toContain("+ # Notes");

    unmount();
  });
});
