/**
 * The normalized agent event stream — the ONLY contract the frontend consumes.
 *
 * Modeled on the Claude Agent SDK message types:
 *   init → assistant(text + tool_use) → tool_result → compact_boundary
 *        → permission_request → result
 * Bulky/structured artifacts (preview HTML, file contents) ride dedicated events
 * or the final result — never the streaming text deltas.
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
  /** A model turn: assistant prose plus any tool calls it requested this turn. */
  | { type: "assistant"; text: string; toolCalls: ToolCall[] }
  /** Result of executing one tool call (concise; bulky payloads use dedicated events). */
  | {
      type: "tool_result";
      toolUseId: string;
      name: string;
      content: string;
      isError: boolean;
      durationMs: number;
    }
  /** Emitted by write/edit/delete tools so the frontend file tree + code view stay live. */
  | {
      type: "file_change";
      op: "write" | "edit" | "delete";
      path: string;
      language?: FileLanguage;
      content?: string;
    }
  /** Emitted by build_preview; carries the self-contained iframe HTML or a build error. */
  | { type: "preview"; ok: boolean; previewHtml?: string; error?: string }
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

/** Request body for POST /api/agent/run. */
export interface RunAgentRequest {
  prompt: string;
  /** Resume an existing session; omit to start a new one. */
  sessionId?: string;
}

/** Request body for POST /api/agent/permission. */
export interface PermissionDecisionRequest {
  requestId: string;
  behavior: "allow" | "deny";
  /** Optional edited tool input when allowing. */
  updatedInput?: Record<string, unknown>;
  message?: string;
}
