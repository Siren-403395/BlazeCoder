/**
 * Ports — the injected boundary of agent-core.
 *
 * agent-core depends ONLY on these interfaces (plus @coding-agent/shared types and
 * Node built-ins). No Fastify, no React, no DeepSeek import reaches the loop. Every
 * port has an in-memory fake for tests; the server app provides the real adapters.
 */

import type {
  AgentEvent,
  GeneratedProject,
  ProjectFile,
  SessionState,
  SessionSummary,
  StopReason,
  TokenUsage,
  ToolCall,
  TranscriptMessage,
} from "@coding-agent/shared";

// The conversation transcript + session shapes are FE↔BE contracts; they live in
// @coding-agent/shared and are re-exported here so the loop, store, and adapters
// can keep importing them from the ports boundary.
export type {
  SessionState,
  SessionStatus,
  SessionSummary,
  ToolResultRecord,
  TranscriptMessage,
} from "@coding-agent/shared";

export type JSONSchema = Record<string, unknown>;

// ─── Model gateway ────────────────────────────────────────────────────────────

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: JSONSchema;
}

export interface ModelRequest {
  system: string;
  messages: TranscriptMessage[];
  tools: ToolSchema[];
  maxOutputTokens?: number;
  temperature?: number;
  /** Enable the model's deep-thinking (reasoning) mode. */
  thinking?: boolean;
}

export interface ModelResponse {
  text: string;
  /** The reasoning trace for this turn, when thinking mode produced one. */
  reasoning?: string;
  toolCalls: ToolCall[];
  stopReason: StopReason;
  usage: TokenUsage;
  costUsd: number;
}

/** Callbacks a streaming gateway invokes as the model produces output. */
export interface ModelStreamHandlers {
  onText(textChunk: string): void;
  /** Incremental reasoning trace (thinking mode); separate channel from onText. */
  onReasoning(textChunk: string): void;
  onToolCall(call: ToolCall): void;
}

export interface ModelGateway {
  readonly model: string;
  complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse>;
  /**
   * Optional streaming variant. When present the loop prefers it and emits the
   * deltas live; the returned ModelResponse is the assembled final turn. Gateways
   * without it (stub, tests) still work via `complete`.
   */
  stream?(request: ModelRequest, signal: AbortSignal, handlers: ModelStreamHandlers): Promise<ModelResponse>;
}

// ─── Workspace (the project file graph the agent edits) ───────────────────────

export interface Workspace {
  list(): ProjectFile[];
  read(path: string): ProjectFile | undefined;
  write(file: ProjectFile): void;
  delete(path: string): boolean;
  exists(path: string): boolean;
  snapshot(): GeneratedProject;
}

// ─── Preview builder (esbuild bundle → self-contained iframe HTML) ────────────

export interface PreviewBuildResult {
  ok: boolean;
  previewHtml?: string;
  error?: string;
}

export interface PreviewBuilder {
  build(project: GeneratedProject): Promise<PreviewBuildResult>;
}

// ─── Sandbox (shell execution backstop; disabled by default) ──────────────────

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export interface Sandbox {
  readonly available: boolean;
  run(
    command: string,
    opts: { cwd?: string; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<SandboxResult>;
}

// ─── Model-driven memory store (sandboxed to /memories) ───────────────────────

export interface MemoryStore {
  view(path: string): Promise<string>;
  create(path: string, content: string): Promise<void>;
  strReplace(path: string, oldStr: string, newStr: string): Promise<void>;
  insert(path: string, line: number, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

// ─── Sessions (conversation persistence) ──────────────────────────────────────

export interface SessionStore {
  create(init: { id: string; model: string; title: string; project: GeneratedProject }): Promise<SessionState>;
  get(id: string): Promise<SessionState | undefined>;
  save(state: SessionState): Promise<void>;
  list(): Promise<SessionSummary[]>;
}

// ─── Cross-cutting utilities ──────────────────────────────────────────────────

export interface Clock {
  now(): number;
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/** The loop and tools push normalized events to the transport through this sink. */
export type EventSink = (event: AgentEvent) => void;
