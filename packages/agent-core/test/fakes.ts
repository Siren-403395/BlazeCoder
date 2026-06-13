/** Shared test doubles for agent-core. */

import type { AgentEvent, ProjectFile, ToolCall } from "@coding-agent/shared";
import {
  InMemoryMemoryStore,
  InMemoryWorkspace,
  ReadLedger,
  FixedClock,
  silentLogger,
} from "../src/index";
import type {
  ModelGateway,
  ModelRequest,
  ModelResponse,
  ModelStreamHandlers,
  Sandbox,
} from "../src/index";
import type { ToolContext } from "../src/index";

export const disabledSandbox: Sandbox = {
  available: false,
  async run() {
    return { stdout: "", stderr: "disabled", exitCode: 1, timedOut: false };
  },
};

/** A sandbox that runs a fixed scripted reply per command (for Bash tool tests). */
export class FakeSandbox implements Sandbox {
  readonly available = true;
  commands: string[] = [];
  constructor(private readonly reply: (cmd: string) => { stdout?: string; stderr?: string; exitCode?: number } = () => ({})) {}
  async run(command: string) {
    this.commands.push(command);
    const r = this.reply(command);
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.exitCode ?? 0, timedOut: false };
  }
}

export type Step = ModelResponse | ((req: ModelRequest, callIndex: number) => ModelResponse);

export class ScriptedGateway implements ModelGateway {
  calls = 0;
  lastRequest: ModelRequest | null = null;
  constructor(
    readonly model: string,
    private readonly steps: Step[],
  ) {}
  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.lastRequest = request;
    const step = this.steps[Math.min(this.calls, this.steps.length - 1)]!;
    const res = typeof step === "function" ? step(request, this.calls) : step;
    this.calls += 1;
    return res;
  }
}

export function reply(text: string, toolCalls: ToolCall[] = [], reasoning?: string): ModelResponse {
  return {
    text,
    reasoning,
    toolCalls,
    stopReason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 5 },
    costUsd: 0.0001,
  };
}

/** Split a string into small pieces so the fake emits several streaming deltas. */
function streamChunks(s: string): string[] {
  return s.match(/[\s\S]{1,8}/g) ?? [];
}

/**
 * A scripted gateway that implements `stream`, so the loop exercises the
 * streaming path: reasoning is emitted as multiple onReasoning deltas (ahead of
 * the prose), then text, then tool calls. Mirrors the real adapter's ordering.
 */
export class StreamingScriptedGateway implements ModelGateway {
  calls = 0;
  lastRequest: ModelRequest | null = null;
  constructor(
    readonly model: string,
    private readonly steps: Step[],
  ) {}

  private next(request: ModelRequest): ModelResponse {
    this.lastRequest = request;
    const step = this.steps[Math.min(this.calls, this.steps.length - 1)]!;
    const res = typeof step === "function" ? step(request, this.calls) : step;
    this.calls += 1;
    return res;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    return this.next(request);
  }

  async stream(
    request: ModelRequest,
    _signal: AbortSignal,
    handlers: ModelStreamHandlers,
  ): Promise<ModelResponse> {
    const res = this.next(request);
    if (res.reasoning) for (const ch of streamChunks(res.reasoning)) handlers.onReasoning(ch);
    if (res.text) for (const ch of streamChunks(res.text)) handlers.onText(ch);
    for (const c of res.toolCalls) handlers.onToolCall(c);
    return res;
  }
}

export function call(id: string, name: string, input: Record<string, unknown> = {}): ToolCall {
  return { id, name, input };
}

export function makeCtx(overrides: Partial<ToolContext> = {}): { ctx: ToolContext; events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  const ctx: ToolContext = {
    sessionId: "s1",
    workspace: overrides.workspace ?? new InMemoryWorkspace(),
    ledger: overrides.ledger ?? new ReadLedger(),
    sandbox: overrides.sandbox ?? disabledSandbox,
    memory: overrides.memory ?? new InMemoryMemoryStore(),
    emit: overrides.emit ?? ((e) => events.push(e)),
    signal: overrides.signal ?? new AbortController().signal,
    logger: overrides.logger ?? silentLogger,
    clock: overrides.clock ?? new FixedClock(0),
  };
  return { ctx, events };
}

/** A complete, valid set of files for a small project. */
export function fullProjectFiles(): ProjectFile[] {
  return [
    { path: "/package.json", language: "json", content: '{\n  "name": "app",\n  "private": true\n}\n' },
    { path: "/index.html", language: "html", content: '<!doctype html><html><body><div id="root"></div></body></html>' },
    { path: "/vite.config.ts", language: "ts", content: "export default {};\n" },
    {
      path: "/src/main.tsx",
      language: "tsx",
      content:
        'import { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./index.css";\ncreateRoot(document.getElementById("root")!).render(<App />);\n',
    },
    {
      path: "/src/App.tsx",
      language: "tsx",
      content: 'export default function App() {\n  return <h1>Hello</h1>;\n}\n',
    },
    { path: "/src/index.css", language: "css", content: "body { margin: 0; }\n" },
  ];
}

/** Build the scripted tool calls that write a full project (one Write per file). */
export function writeFullProjectCalls(): ToolCall[] {
  return fullProjectFiles().map((f, i) => call(`w${i}`, "Write", { file_path: f.path, content: f.content }));
}
