import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import {
  createAgentRuntime,
  FixedClock,
  InMemoryMemoryStore,
  InMemorySessionStore,
  InMemoryWorkspace,
  silentLogger,
} from "@blazecoder/core";
import type { ModelGateway, ModelResponse, OutputStyle, Skill } from "@blazecoder/core";
import { App } from "../src/index";

class StubGW implements ModelGateway {
  readonly model = "stub";
  async complete(): Promise<ModelResponse> {
    return { text: "ok", toolCalls: [], stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0 };
  }
}

const SKILL: Skill = {
  name: "explain",
  description: "Explain the codebase",
  context: "inline",
  body: "SKILL_BODY_MARKER: walk the repo and explain it.",
  dir: "/skills/explain",
};
const STYLES: OutputStyle[] = [
  { name: "terse", description: "one sentence", prompt: "Be terse." },
  { name: "teacher", description: "explain like a mentor", prompt: "Explain thoroughly." },
];

function makeRuntime(extra: { skills?: Skill[]; outputStyles?: OutputStyle[] } = {}) {
  return createAgentRuntime({
    gateway: new StubGW(),
    sessionStore: new InMemorySessionStore(new FixedClock(1000)),
    memory: new InMemoryMemoryStore(),
    workspace: new InMemoryWorkspace(),
    clock: new FixedClock(1000),
    logger: silentLogger,
    ...extra,
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

// After a synchronous setPicker, ink's useInput effect re-subscribes one macrotask later.
// A real terminal's inter-keystroke gap dwarfs this; the test just lets it settle before the
// follow-up key so the handler closes over the open picker (not the stale, pre-open null).
const settle = () => new Promise((r) => setTimeout(r, 60));

describe("/skill palette", () => {
  it("opens a picker of skills and runs the selected one as a turn (expanded body)", async () => {
    const rt = makeRuntime({ skills: [SKILL] });
    const { lastFrame, stdin, unmount } = render(<App runtime={rt} effort="low" />);
    await new Promise((r) => setTimeout(r, 60));

    stdin.write("/skill");
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\r"); // open the picker
    await waitFor(() => (lastFrame() ?? "").includes("Run a skill"));
    expect(lastFrame() ?? "").toContain("explain");
    await settle();

    stdin.write("\r"); // select → submit the expanded skill body as a prompt
    await waitFor(() => (lastFrame() ?? "").includes("SKILL_BODY_MARKER"));
    unmount();
  });

  it("warns when no skills are available", async () => {
    const rt = makeRuntime();
    const { lastFrame, stdin, unmount } = render(<App runtime={rt} effort="low" />);
    await new Promise((r) => setTimeout(r, 60));
    stdin.write("/skill");
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("No skills found"));
    unmount();
  });
});

describe("/output-style palette", () => {
  it("opens a picker (with a default-revert row) and switching shows the style on the input rule", async () => {
    const rt = makeRuntime({ outputStyles: STYLES });
    const { lastFrame, stdin, unmount } = render(<App runtime={rt} effort="low" />);
    await new Promise((r) => setTimeout(r, 60));

    stdin.write("/output-style");
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\r"); // open the picker
    await waitFor(() => (lastFrame() ?? "").includes("Set output style"));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("(default)");
    expect(frame).toContain("terse");
    expect(frame).toContain("teacher");
    await settle();

    stdin.write("\u001b[B"); // down to "terse"
    await settle();
    stdin.write("\r"); // choose it
    await waitFor(() => (lastFrame() ?? "").includes("Output style → terse"));
    // The runtime took the switch and the input rule now carries the style name.
    expect(rt.outputStyle).toBe("terse");
    await waitFor(() => (lastFrame() ?? "").includes("· terse"));
    unmount();
  });
});
