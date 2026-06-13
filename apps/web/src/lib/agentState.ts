/**
 * Pure event→UI-state reduction. The frontend is "dumb": it never executes
 * tools or assembles context - it folds the normalized AgentEvent stream (plus
 * the local `user_prompt` action) into render state. Keeping this pure makes the
 * entire client logic unit-testable.
 *
 * The public surface (`applyEvent`, `initialState`, `fileList`, and the asserted
 * state fields) is stable; everything else is additive.
 */

import type {
  AgentEvent,
  FileLanguage,
  ResultSubtype,
  TokenUsage,
} from "@coding-agent/shared";

export interface UiFile {
  path: string;
  language: FileLanguage;
  content: string;
  /** Content before the most recent edit - enables the diff view. */
  prevContent?: string;
  /** The mutation that last touched this file. */
  lastOp?: "write" | "edit";
}

export type TraceKind = "user" | "assistant" | "tool" | "notice" | "compact";
export type ActivityStatus = "running" | "ok" | "error";

export interface TraceEntry {
  id: string;
  kind: TraceKind;
  text: string;
  /** tool entries */
  toolName?: string;
  input?: Record<string, unknown>;
  status?: ActivityStatus;
  durationMs?: number;
  isError?: boolean;
  /** notice entries */
  level?: "info" | "warn" | "error";
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
  tools?: string[];
  maxTurns?: number;
  files: Record<string, UiFile>;
  previewHtml?: string;
  previewError?: string;
  budget?: Budget;
  trace: TraceEntry[];
  pendingPermission?: PendingPermission;
  resultSummary?: string;
  resultSubtype?: ResultSubtype;
  numTurns?: number;
  totalCostUsd?: number;
  usage?: TokenUsage;
  compactions: number;
  /** Live model-turn count (one per assistant event); settles to the result's value. */
  turns: number;
}

/** Local actions are AgentEvents plus the user's own prompt submissions. */
export type UiAction = AgentEvent | { type: "user_prompt"; text: string };

export const initialState: AgentUiState = {
  status: "idle",
  files: {},
  trace: [],
  compactions: 0,
  turns: 0,
};

function append(state: AgentUiState, entry: Omit<TraceEntry, "id"> & { id?: string }): AgentUiState {
  const { id, ...rest } = entry;
  return { ...state, trace: [...state.trace, { id: id ?? `e${state.trace.length}`, ...rest }] };
}

export function applyEvent(state: AgentUiState, action: UiAction): AgentUiState {
  switch (action.type) {
    case "user_prompt": {
      const text = action.text.trim();
      if (!text) return state;
      return append(
        { ...state, status: "running", resultSummary: undefined, resultSubtype: undefined },
        { kind: "user", text },
      );
    }

    case "system":
      return {
        ...state,
        status: "running",
        sessionId: action.sessionId,
        model: action.model,
        tools: action.tools,
        maxTurns: action.maxTurns,
      };

    case "assistant": {
      let next = state;
      const text = action.text.trim();
      if (text) next = append(next, { kind: "assistant", text });
      for (const call of action.toolCalls) {
        next = append(next, {
          id: call.id,
          kind: "tool",
          toolName: call.name,
          input: call.input,
          status: "running",
          text: "",
        });
      }
      return { ...next, turns: state.turns + 1, pendingPermission: undefined };
    }

    case "tool_result": {
      const status: ActivityStatus = action.isError ? "error" : "ok";
      const idx = state.trace.findIndex((t) => t.kind === "tool" && t.id === action.toolUseId);
      if (idx >= 0) {
        const trace = state.trace.slice();
        const prev = trace[idx]!;
        trace[idx] = {
          ...prev,
          toolName: prev.toolName ?? action.name,
          text: action.content,
          isError: action.isError,
          status,
          durationMs: action.durationMs,
        };
        return { ...state, trace, pendingPermission: undefined };
      }
      // Orphan result (no preceding tool_use seen in the stream).
      return append(
        { ...state, pendingPermission: undefined },
        {
          id: action.toolUseId,
          kind: "tool",
          toolName: action.name,
          text: action.content,
          isError: action.isError,
          status,
          durationMs: action.durationMs,
        },
      );
    }

    case "file_change": {
      const files = { ...state.files };
      if (action.op === "delete") {
        delete files[action.path];
      } else {
        const existing = files[action.path];
        files[action.path] = {
          path: action.path,
          language: action.language ?? existing?.language ?? "txt",
          content: action.content ?? "",
          prevContent: existing?.content,
          lastOp: action.op,
        };
      }
      return { ...state, files };
    }

    case "preview":
      return action.ok
        ? { ...state, previewHtml: action.previewHtml, previewError: undefined }
        : { ...state, previewError: action.error };

    case "budget":
      return {
        ...state,
        budget: {
          totalTokens: action.totalTokens,
          usedTokens: action.usedTokens,
          remainingTokens: action.remainingTokens,
        },
      };

    case "compact_boundary":
      return append(
        { ...state, compactions: state.compactions + 1 },
        { kind: "compact", text: `Context compacted: ${action.reason}` },
      );

    case "permission_request":
      return {
        ...state,
        status: "awaiting_permission",
        pendingPermission: {
          requestId: action.requestId,
          toolName: action.toolName,
          reason: action.reason,
          input: action.input,
        },
      };

    case "notice":
      return append(state, { kind: "notice", level: action.level, text: action.message });

    case "result":
      return {
        ...state,
        status: action.subtype === "success" ? "done" : "error",
        resultSubtype: action.subtype,
        resultSummary: action.summary,
        numTurns: action.numTurns,
        totalCostUsd: action.totalCostUsd,
        usage: action.usage,
        pendingPermission: undefined,
      };

    default:
      return state;
  }
}

export function fileList(state: AgentUiState): UiFile[] {
  return Object.values(state.files).sort((a, b) => a.path.localeCompare(b.path));
}

/** Compact run statistics for the status bar. */
export interface RunStats {
  model?: string;
  numTurns?: number;
  maxTurns?: number;
  costUsd?: number;
  budget?: Budget;
  compactions: number;
  fileCount: number;
}

export function runStats(state: AgentUiState): RunStats {
  return {
    model: state.model,
    numTurns: state.numTurns ?? state.turns,
    maxTurns: state.maxTurns,
    costUsd: state.totalCostUsd,
    budget: state.budget,
    compactions: state.compactions,
    fileCount: Object.keys(state.files).length,
  };
}
