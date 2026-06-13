/**
 * Ports — the injected boundary of agent-core.
 *
 * agent-core depends ONLY on these interfaces (plus @coding-agent/shared types and
 * Node built-ins). No TUI, no HTTP, no DeepSeek import reaches the loop. Every
 * port has an in-memory fake for tests; the CLI package provides the real adapters
 * (DeepSeek gateway, OS sandbox) and wires the runtime in-process.
 */

import type {
  AgentEvent,
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
  /** Native reasoning depth when thinking is on (DeepSeek-V4-Pro: high | max). */
  thinkingBudget?: "high" | "max";
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
  /** A transient failure is being retried with backoff (so the UI can show it). */
  onRetry?(info: { attempt: number; maxRetries: number; delayMs: number; status?: number }): void;
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

// ─── Workspace (the real filesystem the agent edits, scoped to its roots) ─────

/** A file's identity stamp, used by the read-before-edit ledger. */
export interface FileStamp {
  mtimeMs: number;
  size: number;
}

/** read() returns content + the stamp captured at read time (atomic), so the ledger records exactly what was read. */
export type ReadFile = ProjectFile & { stamp: FileStamp };

export interface Workspace {
  /** Canonical absolute primary root (the cwd the agent is scoped to). */
  readonly root: string;
  /** Resolve an agent-supplied path to a canonical absolute path inside the boundary, or throw. */
  resolve(inputPath: string): string;
  /** Whether writes are permitted to this (already-resolved) path. */
  isWritable(absPath: string): boolean;
  read(absPath: string): Promise<ReadFile | null>;
  write(file: ProjectFile): Promise<void>;
  delete(absPath: string): Promise<boolean>;
  exists(absPath: string): Promise<boolean>;
  stat(absPath: string): Promise<FileStamp | null>;
  /** Enumerate files under the root as canonical absolute paths, bounded. */
  walk(opts?: { respectGitignore?: boolean; limit?: number }): Promise<string[]>;
}

// ─── Sandbox (shell execution; the real adapter runs commands under an OS sandbox) ─

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
  create(init: { id: string; model: string; title: string; cwd: string }): Promise<SessionState>;
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
