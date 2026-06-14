import { describe, expect, it } from "vitest";
import {
  createAgentRuntime,
  FixedClock,
  InMemoryMemoryStore,
  InMemorySessionStore,
  InMemoryWorkspace,
  silentLogger,
} from "@blazecoder/core";
import type { ModelGateway, ModelResponse } from "@blazecoder/core";
import { runHeadless } from "../src/index";

class ScriptedGateway implements ModelGateway {
  readonly model = "scripted";
  calls = 0;
  constructor(private readonly steps: ModelResponse[]) {}
  async complete(): Promise<ModelResponse> {
    const s = this.steps[Math.min(this.calls, this.steps.length - 1)]!;
    this.calls += 1;
    return s;
  }
}
const mk = (text: string, toolCalls: ModelResponse["toolCalls"] = []): ModelResponse => ({
  text,
  toolCalls,
  stopReason: "end_turn",
  usage: { inputTokens: 5, outputTokens: 5 },
  costUsd: 0.0001,
});

function buffer() {
  let s = "";
  return { write: (x: string) => (s += x), get: () => s };
}

function runtimeWith(steps: ModelResponse[], ws = new InMemoryWorkspace(), mode: "acceptEdits" | "bypassPermissions" = "acceptEdits") {
  return createAgentRuntime({
    gateway: new ScriptedGateway(steps),
    sessionStore: new InMemorySessionStore(new FixedClock(1)),
    memory: new InMemoryMemoryStore(),
    workspace: ws,
    permissionMode: mode,
    clock: new FixedClock(1),
    logger: silentLogger,
  });
}

describe("runHeadless", () => {
  it("text format writes assistant prose and returns 0 on success", async () => {
    const ws = new InMemoryWorkspace();
    const rt = runtimeWith(
      [mk("Creating it.", [{ id: "w", name: "Write", input: { file_path: "/a.ts", content: "x\n" } }]), mk("All done.")],
      ws,
    );
    const out = buffer();
    const err = buffer();
    const code = await runHeadless(rt, { prompt: "go", effort: "low", format: "text", out, err });
    expect(code).toBe(0);
    expect(out.get()).toContain("All done.");
    expect(err.get()).toContain("Write"); // tool activity to stderr
    expect((await ws.read("/a.ts"))?.content).toBe("x\n");
  });

  it("json format emits a single final result object", async () => {
    const rt = runtimeWith([mk("Done.")]);
    const out = buffer();
    const code = await runHeadless(rt, { prompt: "go", effort: "low", format: "json", out, err: buffer() });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.get());
    expect(parsed.subtype).toBe("success");
    expect(typeof parsed.sessionId).toBe("string");
    expect(parsed.summary).toBe("Done.");
  });

  it("stream-json emits one JSON event per line", async () => {
    const rt = runtimeWith([mk("Done.")]);
    const out = buffer();
    await runHeadless(rt, { prompt: "go", effort: "low", format: "stream-json", out, err: buffer() });
    const lines = out.get().trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0].type).toBe("system");
    expect(lines.at(-1).type).toBe("result");
  });

  it("auto-denies a permission prompt (no hang) and reports the run", async () => {
    // acceptEdits asks for Bash; headless has no approver, so it must auto-deny.
    const rt = runtimeWith([
      mk("Running a command.", [{ id: "b", name: "Bash", input: { command: "echo hi" } }]),
      mk("Recovered after denial."),
    ]);
    const out = buffer();
    const code = await runHeadless(rt, { prompt: "go", effort: "low", format: "json", out, err: buffer() });
    expect(code).toBe(0);
    expect(JSON.parse(out.get()).subtype).toBe("success");
  });
});
