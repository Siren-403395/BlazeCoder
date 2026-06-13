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
  SessionState,
  SessionStatus,
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
  /** assistant entries: true while prose is still streaming in. */
  streaming?: boolean;
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

/** Local actions: AgentEvents plus the user's prompt and session load/reset. */
export type UiAction =
  | AgentEvent
  | { type: "user_prompt"; text: string }
  | { type: "hydrate"; session: SessionState }
  | { type: "reset" };

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

/** Index of the assistant entry currently streaming, or -1. */
function findLastStreamingAssistant(trace: TraceEntry[]): number {
  for (let i = trace.length - 1; i >= 0; i--) {
    const t = trace[i]!;
    if (t.kind === "assistant" && t.streaming) return i;
  }
  return -1;
}

export function applyEvent(state: AgentUiState, action: UiAction): AgentUiState {
  switch (action.type) {
    case "reset":
      return initialState;

    case "hydrate":
      return hydrateFromSession(action.session);

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

    case "assistant_delta": {
      const idx = findLastStreamingAssistant(state.trace);
      if (idx >= 0) {
        const trace = state.trace.slice();
        const prev = trace[idx]!;
        trace[idx] = { ...prev, text: prev.text + action.text };
        return { ...state, status: "running", trace };
      }
      return append({ ...state, status: "running" }, { kind: "assistant", text: action.text, streaming: true });
    }

    case "tool_call": {
      if (state.trace.some((t) => t.kind === "tool" && t.id === action.id)) return state;
      return append(state, {
        id: action.id,
        kind: "tool",
        toolName: action.name,
        input: action.input,
        status: "running",
        text: "",
      });
    }

    case "assistant": {
      // Reconcile: finalize a streaming entry if present, else create one
      // (non-streaming path); ensure a row exists per tool call (dedup by id).
      const text = action.text.trim();
      let trace = state.trace;
      const liveIdx = findLastStreamingAssistant(trace);
      if (liveIdx >= 0) {
        trace = trace.slice();
        const prev = trace[liveIdx]!;
        trace[liveIdx] = { ...prev, text: text || prev.text, streaming: false };
      } else if (text) {
        trace = [...trace, { id: `e${trace.length}`, kind: "assistant", text }];
      }
      for (const call of action.toolCalls) {
        if (!trace.some((t) => t.kind === "tool" && t.id === call.id)) {
          trace = [
            ...trace,
            { id: call.id, kind: "tool", toolName: call.name, input: call.input, status: "running", text: "" },
          ];
        }
      }
      // Count tool-use turns only, matching the server's cap semantics (a final
      // no-tool answer is not a turn).
      const turns = state.turns + (action.toolCalls.length > 0 ? 1 : 0);
      return { ...state, trace, turns, pendingPermission: undefined };
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

function uiStatusFromSession(status: SessionStatus): UiStatus {
  // A loaded session is never mid-run; collapse running/awaiting back to idle.
  return status === "done" || status === "error" ? status : "idle";
}

/**
 * Rebuild full UI state from a persisted session: files from the project
 * snapshot, and the conversation by replaying the transcript (pairing each tool
 * result back to its call). Pure, so it is unit-testable.
 */
export function hydrateFromSession(session: SessionState): AgentUiState {
  const files: Record<string, UiFile> = {};
  for (const f of session.project.files) {
    files[f.path] = { path: f.path, language: f.language, content: f.content };
  }

  const trace: TraceEntry[] = [];
  let counter = 0;
  const nextId = () => `h${counter++}`;
  let compactions = 0;

  for (const message of session.messages) {
    switch (message.role) {
      case "user":
        trace.push({ id: nextId(), kind: "user", text: message.content });
        break;
      case "assistant":
        if (message.content.trim()) trace.push({ id: nextId(), kind: "assistant", text: message.content });
        for (const call of message.toolCalls) {
          trace.push({ id: call.id, kind: "tool", toolName: call.name, input: call.input, status: "ok", text: "" });
        }
        break;
      case "tool":
        for (const result of message.results) {
          const status: ActivityStatus = result.isError ? "error" : "ok";
          const existing = trace.find((e) => e.kind === "tool" && e.id === result.toolUseId);
          if (existing) {
            existing.text = result.content;
            existing.isError = result.isError;
            existing.status = status;
          } else {
            trace.push({
              id: result.toolUseId,
              kind: "tool",
              toolName: result.toolName,
              text: result.content,
              isError: result.isError,
              status,
            });
          }
        }
        break;
      case "summary":
        compactions += 1;
        trace.push({ id: nextId(), kind: "compact", text: "Context compacted" });
        break;
    }
  }

  return {
    status: uiStatusFromSession(session.status),
    sessionId: session.id,
    model: session.model,
    files,
    trace,
    compactions,
    turns: session.turns,
    numTurns: session.turns,
    totalCostUsd: session.costUsd,
    usage: session.usage,
  };
}
