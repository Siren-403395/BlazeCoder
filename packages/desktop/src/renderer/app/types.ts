/**
 * The renderer view-model. A single UiState is folded from the AgentEvent stream by the
 * pure reducer; every component renders a slice of it via props. Mirrors the TUI's
 * cli/src/tui/state.ts view-model as a deliberate sibling keyed to the same AgentEvent
 * contract (the GUI additionally surfaces the reasoning trace and delegated sub-agents).
 */

import type { FileDiff, TodoItem } from "@blazecoder/shared";

export type RunStatus = "idle" | "running" | "awaiting_permission";

export interface UserItem {
  id: string;
  kind: "user";
  text: string;
}

export interface AssistantItem {
  id: string;
  kind: "assistant";
  text: string;
  reasoning: string;
  complete: boolean;
}

export interface ToolItem {
  id: string;
  kind: "tool";
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  isError?: boolean;
  durationMs?: number;
  diff?: FileDiff;
  filePath?: string;
  op?: "write" | "edit" | "delete";
}

export interface NoticeItem {
  id: string;
  kind: "notice";
  level: "info" | "warn" | "error";
  text: string;
}

export interface BoundaryItem {
  id: string;
  kind: "boundary";
  text: string;
}

export interface SubagentItem {
  id: string;
  kind: "subagent";
  agentType: string;
  description: string;
  running: boolean;
  summary?: string;
}

export type TimelineItem = UserItem | AssistantItem | ToolItem | NoticeItem | BoundaryItem | SubagentItem;

export interface PermissionPrompt {
  requestId: string;
  toolName: string;
  reason: string;
  input: Record<string, unknown>;
  suggestions: string[];
  risk?: { level: string; category: string; reason: string };
}

export interface BudgetState {
  totalTokens: number;
  usedTokens: number;
  remainingTokens: number;
}

export interface UiState {
  timeline: TimelineItem[];
  permission: PermissionPrompt | null;
  budget: BudgetState | null;
  todos: TodoItem[];
  selectedToolId?: string;
  status: RunStatus;
  sessionId?: string;
  model?: string;
  /** Id of the in-flight streaming assistant item, if any (mirrors the TUI's liveAssistantId). */
  liveAssistantId?: string;
  /** Monotonic id source, kept in state so the reducer stays pure and deterministic. */
  seq: number;
}

export const initialUiState: UiState = {
  timeline: [],
  permission: null,
  budget: null,
  todos: [],
  status: "idle",
  seq: 0,
};
