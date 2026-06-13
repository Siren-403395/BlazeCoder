/**
 * Pure event→UI-state reduction. The frontend is "dumb": it never executes tools
 * or assembles context — it folds the normalized AgentEvent stream into render
 * state. Keeping this a pure function makes the whole client logic unit-testable.
 */

import type { AgentEvent, FileLanguage } from "@coding-agent/shared";

export interface UiFile {
  path: string;
  language: FileLanguage;
  content: string;
}

export interface TraceEntry {
  id: string;
  kind: "assistant" | "tool" | "notice" | "compact";
  text: string;
  toolName?: string;
  isError?: boolean;
}

export interface PendingPermission {
  requestId: string;
  toolName: string;
  reason: string;
  input: Record<string, unknown>;
}

export interface Budget {
  totalTokens: number;
  usedTokens: number;
  remainingTokens: number;
}

export type UiStatus = "idle" | "running" | "awaiting_permission" | "done" | "error";

export interface AgentUiState {
  status: UiStatus;
  sessionId?: string;
  model?: string;
  files: Record<string, UiFile>;
  previewHtml?: string;
  previewError?: string;
  budget?: Budget;
  trace: TraceEntry[];
  pendingPermission?: PendingPermission;
  resultSummary?: string;
}

export const initialState: AgentUiState = {
  status: "idle",
  files: {},
  trace: [],
};

function withTrace(state: AgentUiState, entry: Omit<TraceEntry, "id">): AgentUiState {
  return { ...state, trace: [...state.trace, { id: String(state.trace.length), ...entry }] };
}

export function applyEvent(state: AgentUiState, event: AgentEvent): AgentUiState {
  switch (event.type) {
    case "system":
      return { ...state, status: "running", sessionId: event.sessionId, model: event.model };

    case "assistant": {
      const next = event.text.trim()
        ? withTrace(state, { kind: "assistant", text: event.text })
        : state;
      return { ...next, pendingPermission: undefined };
    }

    case "tool_result":
      return withTrace(
        { ...state, pendingPermission: undefined },
        { kind: "tool", toolName: event.name, text: event.content, isError: event.isError },
      );

    case "file_change": {
      const files = { ...state.files };
      if (event.op === "delete") {
        delete files[event.path];
      } else {
        files[event.path] = {
          path: event.path,
          language: event.language ?? "txt",
          content: event.content ?? "",
        };
      }
      return { ...state, files };
    }

    case "preview":
      return event.ok
        ? { ...state, previewHtml: event.previewHtml, previewError: undefined }
        : { ...state, previewError: event.error };

    case "budget":
      return {
        ...state,
        budget: {
          totalTokens: event.totalTokens,
          usedTokens: event.usedTokens,
          remainingTokens: event.remainingTokens,
        },
      };

    case "compact_boundary":
      return withTrace(state, { kind: "compact", text: `Context compacted — ${event.reason}` });

    case "permission_request":
      return {
        ...state,
        status: "awaiting_permission",
        pendingPermission: {
          requestId: event.requestId,
          toolName: event.toolName,
          reason: event.reason,
          input: event.input,
        },
      };

    case "notice":
      return withTrace(state, { kind: "notice", text: `[${event.level}] ${event.message}` });

    case "result":
      return {
        ...state,
        status: event.subtype === "success" ? "done" : "error",
        resultSummary: event.summary,
        pendingPermission: undefined,
      };

    default:
      return state;
  }
}

export function fileList(state: AgentUiState): UiFile[] {
  return Object.values(state.files).sort((a, b) => a.path.localeCompare(b.path));
}
