/**
 * The TUI's pure event -> view reducer. The Ink components are a thin render of
 * this state; all the logic lives here so it can be unit-tested without a
 * terminal. It folds the normalized AgentEvent stream (plus two synthetic UI
 * actions) into a flat list of scrollback items + run status, mirroring how the
 * old web reducer worked but adapted to the CLI event shape (no preview).
 */

import type { AgentEvent } from "@coding-agent/shared";

export type ToolStatus = "running" | "ok" | "error";

export type Item =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string; reasoning?: string; streaming: boolean }
  | { kind: "tool"; id: string; name: string; status: ToolStatus; input: Record<string, unknown>; summary?: string; durationMs?: number }
  | { kind: "notice"; id: string; level: "info" | "warn" | "error"; message: string }
  | { kind: "compact"; id: string; reason: string }
  | { kind: "result"; id: string; subtype: string; summary: string };

export interface PendingPermission {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  reason: string;
}

export type RunStatus = "idle" | "running" | "awaiting_permission" | "done" | "error";

export interface TuiState {
  items: Item[];
  status: RunStatus;
  model?: string;
  effort: string;
  turns: number;
  maxTurns: number;
  costUsd: number;
  tokensUsed: number;
  tokensTotal: number;
  permission?: PendingPermission;
  /** Monotonic id source (kept in state so the reducer stays pure). */
  seq: number;
  /** Id of the in-flight streaming assistant item, if any. */
  liveAssistantId?: string;
}

export type UiAction =
  | AgentEvent
  | { type: "user_prompt"; text: string }
  | { type: "set_effort"; effort: string }
  | { type: "permission_resolved" }
  | { type: "reset" };

export function initialState(effort = "high"): TuiState {
  return {
    items: [],
    status: "idle",
    effort,
    turns: 0,
    maxTurns: 0,
    costUsd: 0,
    tokensUsed: 0,
    tokensTotal: 0,
    seq: 0,
  };
}

function id(state: TuiState, prefix: string): [string, number] {
  const n = state.seq + 1;
  return [`${prefix}${n}`, n];
}

/** Short, single-line summary of a tool result for the scrollback. */
function firstLine(text: string, max = 200): string {
  const line = text.split("\n")[0] ?? "";
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

export function applyEvent(state: TuiState, action: UiAction): TuiState {
  switch (action.type) {
    case "reset":
      return { ...initialState(state.effort), model: state.model };

    case "set_effort":
      return { ...state, effort: action.effort };

    case "permission_resolved":
      // The user answered the prompt; the loop resumes and will emit more events.
      return { ...state, status: "running", permission: undefined };

    case "user_prompt": {
      const [uid, seq] = id(state, "u");
      return {
        ...state,
        seq,
        status: "running",
        permission: undefined,
        liveAssistantId: undefined,
        items: [...state.items, { kind: "user", id: uid, text: action.text }],
      };
    }

    case "system":
      return {
        ...state,
        model: action.model,
        maxTurns: action.maxTurns,
        tokensTotal: action.contextTokens,
      };

    case "assistant_delta": {
      const live = state.items.find((i) => i.id === state.liveAssistantId && i.kind === "assistant");
      if (live && live.kind === "assistant") {
        return {
          ...state,
          items: state.items.map((i) =>
            i.id === live.id && i.kind === "assistant" ? { ...i, text: i.text + action.text } : i,
          ),
        };
      }
      const [aid, seq] = id(state, "a");
      return {
        ...state,
        seq,
        liveAssistantId: aid,
        items: [...state.items, { kind: "assistant", id: aid, text: action.text, streaming: true }],
      };
    }

    case "reasoning_delta": {
      const live = state.items.find((i) => i.id === state.liveAssistantId && i.kind === "assistant");
      if (live && live.kind === "assistant") {
        return {
          ...state,
          items: state.items.map((i) =>
            i.id === live.id && i.kind === "assistant" ? { ...i, reasoning: (i.reasoning ?? "") + action.text } : i,
          ),
        };
      }
      const [aid, seq] = id(state, "a");
      return {
        ...state,
        seq,
        liveAssistantId: aid,
        items: [...state.items, { kind: "assistant", id: aid, text: "", reasoning: action.text, streaming: true }],
      };
    }

    case "tool_call": {
      if (state.items.some((i) => i.id === action.id)) return state;
      return {
        ...state,
        items: [...state.items, { kind: "tool", id: action.id, name: action.name, status: "running", input: action.input }],
      };
    }

    case "assistant": {
      // Finalize the streaming assistant entry (or create one if no deltas arrived).
      let items = state.items;
      const live = items.find((i) => i.id === state.liveAssistantId && i.kind === "assistant");
      if (live && live.kind === "assistant") {
        items = items.map((i) =>
          i.id === live.id && i.kind === "assistant"
            ? { ...i, text: action.text, reasoning: action.reasoning ?? i.reasoning, streaming: false }
            : i,
        );
      } else if (action.text || action.reasoning) {
        const [aid, seq] = id(state, "a");
        items = [...items, { kind: "assistant", id: aid, text: action.text, reasoning: action.reasoning, streaming: false }];
        // Ensure tool items exist for any tool calls this turn.
        const withTools = ensureToolItems(items, action.toolCalls);
        return { ...state, seq, liveAssistantId: undefined, items: withTools };
      }
      return { ...state, liveAssistantId: undefined, items: ensureToolItems(items, action.toolCalls) };
    }

    case "tool_result": {
      return {
        ...state,
        items: state.items.map((i) =>
          i.id === action.toolUseId && i.kind === "tool"
            ? { ...i, status: action.isError ? "error" : "ok", summary: firstLine(action.content), durationMs: action.durationMs }
            : i,
        ),
      };
    }

    case "budget":
      return { ...state, tokensUsed: action.usedTokens, tokensTotal: action.totalTokens };

    case "compact_boundary": {
      const [cid, seq] = id(state, "c");
      return { ...state, seq, items: [...state.items, { kind: "compact", id: cid, reason: action.reason }] };
    }

    case "permission_request":
      return {
        ...state,
        status: "awaiting_permission",
        permission: {
          requestId: action.requestId,
          toolName: action.toolName,
          input: action.input,
          reason: action.reason,
        },
      };

    case "notice": {
      const [nid, seq] = id(state, "n");
      return { ...state, seq, items: [...state.items, { kind: "notice", id: nid, level: action.level, message: action.message }] };
    }

    case "result": {
      const [rid, seq] = id(state, "r");
      return {
        ...state,
        seq,
        status: action.subtype === "success" ? "done" : action.subtype === "cancelled" ? "idle" : "error",
        turns: action.numTurns,
        costUsd: action.totalCostUsd,
        permission: undefined,
        liveAssistantId: undefined,
        items: [...state.items, { kind: "result", id: rid, subtype: action.subtype, summary: action.summary }],
      };
    }

    case "file_change":
      // Mutations are summarized by the tool_result line; nothing extra to render here.
      return state;

    default:
      return state;
  }
}

function ensureToolItems(items: Item[], toolCalls: { id: string; name: string; input: Record<string, unknown> }[]): Item[] {
  let out = items;
  for (const c of toolCalls) {
    if (!out.some((i) => i.id === c.id)) {
      out = [...out, { kind: "tool", id: c.id, name: c.name, status: "running", input: c.input }];
    }
  }
  return out;
}

export function reduce(actions: UiAction[], effort = "high"): TuiState {
  return actions.reduce(applyEvent, initialState(effort));
}
