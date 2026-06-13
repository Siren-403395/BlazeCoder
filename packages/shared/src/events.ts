/**
 * The normalized agent event stream — the ONLY contract the TUI consumes.
 *
 * Modeled on the Claude Agent SDK message types:
 *   init → assistant(text + tool_use) → tool_result → compact_boundary
 *        → permission_request → result
 * Bulky/structured artifacts (file contents) ride dedicated events or the final
 * result — never the streaming text deltas.
 */

import type { FileLanguage } from "./projectSchema";

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export type ResultSubtype =
  | "success"
  | "error_max_turns"
  | "error_max_budget_usd"
  | "error_during_execution"
  | "error_compaction_thrash"
  | "cancelled";

export type StopReason = "end_turn" | "max_tokens" | "stop_sequence" | "refusal" | null;

export type AgentEvent =
  | {
      type: "system";
      subtype: "init";
      sessionId: string;
      model: string;
      tools: string[];
      maxTurns: number;
      contextTokens: number;
    }
  /** A model turn: assistant prose, optional reasoning trace, and any tool calls. */
  | { type: "assistant"; text: string; reasoning?: string; toolCalls: ToolCall[] }
  /** Incremental assistant prose during streaming; concatenate in arrival order. */
  | { type: "assistant_delta"; text: string }
  /** Incremental reasoning (deep-thinking) trace during streaming; concatenate in order. */
  | { type: "reasoning_delta"; text: string }
  /** A tool call surfaced live during streaming, before it executes. */
  | { type: "tool_call"; id: string; name: string; input: Record<string, unknown> }
  /** Result of executing one tool call (concise; bulky payloads use dedicated events). */
  | {
      type: "tool_result";
      toolUseId: string;
      name: string;
      content: string;
      isError: boolean;
      durationMs: number;
    }
  /** Emitted by write/edit/delete tools so the TUI's file/diff view stays live. */
  | {
      type: "file_change";
      op: "write" | "edit" | "delete";
      path: string;
      language?: FileLanguage;
      content?: string;
    }
  /** Context budget gauge update (after each turn / compaction). */
  | { type: "budget"; totalTokens: number; usedTokens: number; remainingTokens: number }
  /** A compaction occurred between two turns. */
  | { type: "compact_boundary"; reason: string; tokensBefore: number; tokensAfter: number }
  /** The loop is blocked awaiting a human allow/deny decision. */
  | {
      type: "permission_request";
      requestId: string;
      toolName: string;
      input: Record<string, unknown>;
      reason: string;
    }
  /** Out-of-band notice (warnings, info). */
  | { type: "notice"; level: "info" | "warn" | "error"; message: string }
  /** Terminal event for a run. */
  | {
      type: "result";
      subtype: ResultSubtype;
      numTurns: number;
      sessionId: string;
      stopReason: StopReason;
      totalCostUsd: number;
      usage: TokenUsage;
      summary: string;
    };

export type AgentEventType = AgentEvent["type"];
