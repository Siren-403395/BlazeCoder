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
  StopReason,
  TokenUsage,
  ToolCall,
} from "@coding-agent/shared";

export type JSONSchema = Record<string, unknown>;

// ─── Conversation transcript (normalized, provider-agnostic) ──────────────────

export interface ToolResultRecord {
  toolUseId: string;
  toolName: string;
  content: string;
  isError: boolean;
}

export type TranscriptMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls: ToolCall[] }
  | { role: "tool"; results: ToolResultRecord[] }
  /** Replaces collapsed history after compaction; rendered to the model as context. */
  | { role: "summary"; content: string };

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
}

export interface ModelResponse {
  text: string;
  toolCalls: ToolCall[];
  stopReason: StopReason;
  usage: TokenUsage;
  costUsd: number;
}

export interface ModelGateway {
  readonly model: string;
  complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse>;
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

export type SessionStatus =
  | "idle"
  | "running"
  | "awaiting_permission"
  | "done"
  | "error";

export interface SessionState {
  id: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  title: string;
  messages: TranscriptMessage[];
  project: GeneratedProject;
  turns: number;
  costUsd: number;
  usage: TokenUsage;
  status: SessionStatus;
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: number;
}

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
