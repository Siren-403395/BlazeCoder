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
import type { ModelGateway, ModelRequest, ModelResponse } from "@coding-agent/core";
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

    unmount();
  });
});
