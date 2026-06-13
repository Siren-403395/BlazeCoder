/**
 * Session + transcript contracts. These cross the FE↔BE boundary (the web client
 * loads a persisted session to resume it), so they live in shared. agent-core
 * re-exports them from its ports for the loop and adapters.
 */

import type { TokenUsage, ToolCall } from "./events";

export interface ToolResultRecord {
  toolUseId: string;
  toolName: string;
  content: string;
  isError: boolean;
}

export type TranscriptMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; reasoning?: string; toolCalls: ToolCall[] }
  | { role: "tool"; results: ToolResultRecord[] }
  /** Replaces collapsed history after compaction; rendered to the model as context. */
  | { role: "summary"; content: string };

export type SessionStatus = "idle" | "running" | "awaiting_permission" | "done" | "error";

export interface SessionState {
  id: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  title: string;
  messages: TranscriptMessage[];
  /** Absolute working directory the agent operated in (the workspace root). */
  cwd: string;
  turns: number;
  costUsd: number;
  usage: TokenUsage;
  status: SessionStatus;
  /**
   * The authoritative input-token count the model server reported on the most
   * recent turn. Compaction prefers this over the char-heuristic estimate, since
   * it is the real number the next request will be measured against.
   */
  lastRealInputTokens?: number;
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: number;
  /** Workspace the session ran in — used to scope resume to the current project. */
  cwd: string;
}
