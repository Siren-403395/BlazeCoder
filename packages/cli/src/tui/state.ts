/**
 * The TUI's pure event -> view reducer. The Ink components are a thin render of
 * this state; all the logic lives here so it can be unit-tested without a
 * terminal. It folds the normalized AgentEvent stream (plus a few synthetic UI
 * actions) into a flat list of scrollback items + run status.
 *
 * The model's reasoning trace is NOT rendered (Claude-Code style): instead we
 * only track how many output chars streamed this turn (`turnChars`) so the live
 * region can show a growing token counter while it thinks.
 */

import type { AgentEvent, SessionState, TodoItem, TranscriptMessage } from "@coding-agent/shared";

export type ToolStatus = "running" | "ok" | "error";

export type Item =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string; streaming: boolean }
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
  /** Estimated output chars streamed this turn — drives the live token counter. */
  turnChars: number;
  turns: number;
  maxTurns: number;
  costUsd: number;
  tokensUsed: number;
  tokensTotal: number;
  permission?: PendingPermission;
  /** The live task list (TodoWrite); rendered as a panel above the input. */
  todos: TodoItem[];
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
  | { type: "hydrate"; session: SessionState }
  | { type: "reset" };

export function initialState(effort = "high"): TuiState {
  return {
    items: [],
    status: "idle",
    effort,
    turnChars: 0,
    turns: 0,
    maxTurns: 0,
    costUsd: 0,
    tokensUsed: 0,
    tokensTotal: 0,
    todos: [],
    seq: 0,
  };
}

function id(state: TuiState, prefix: string): [string, number] {
  const n = state.seq + 1;
  return [`${prefix}${n}`, n];
}

/**
 * Upper bound on retained scrollback items. The view paints an even smaller
 * window; this just keeps the in-memory transcript from growing without bound
 * across a long session. Trimmed only at safe boundaries (a new prompt, a
 * hydrate) where no streaming item is in flight, so live ids are never dropped.
 */
const MAX_ITEMS = 200;

function cap(items: Item[]): Item[] {
  return items.length > MAX_ITEMS ? items.slice(-MAX_ITEMS) : items;
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

    case "hydrate": {
      const { items, seq } = hydrateItems(state.seq, action.session.messages);
      // Replace the screen entirely with the resumed transcript (bounded), so a
      // resume never stacks on top of whatever was already shown.
      return { ...state, items: cap(items), seq, model: action.session.model, status: "done", turnChars: 0 };
    }

    case "user_prompt": {
      const [uid, seq] = id(state, "u");
      return {
        ...state,
        seq,
        status: "running",
        permission: undefined,
        liveAssistantId: undefined,
        turnChars: 0,
        items: cap([...state.items, { kind: "user", id: uid, text: action.text }]),
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
      const turnChars = state.turnChars + action.text.length;
      const live = state.items.find((i) => i.id === state.liveAssistantId && i.kind === "assistant");
      if (live && live.kind === "assistant") {
        return {
          ...state,
          turnChars,
          items: state.items.map((i) =>
            i.id === live.id && i.kind === "assistant" ? { ...i, text: i.text + action.text } : i,
          ),
        };
      }
      const [aid, seq] = id(state, "a");
      return {
        ...state,
        seq,
        turnChars,
        liveAssistantId: aid,
        items: [...state.items, { kind: "assistant", id: aid, text: action.text, streaming: true }],
      };
    }

    case "reasoning_delta":
      // Thinking is not rendered — only counted, so the live region shows tokens growing.
      return { ...state, turnChars: state.turnChars + action.text.length };

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
          i.id === live.id && i.kind === "assistant" ? { ...i, text: action.text, streaming: false } : i,
        );
      } else if (action.text) {
        const [aid, seq] = id(state, "a");
        items = [...items, { kind: "assistant", id: aid, text: action.text, streaming: false }];
        return { ...state, seq, liveAssistantId: undefined, items: ensureToolItems(items, action.toolCalls) };
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

    case "todos":
      // Full replace; the panel shows the live list and is cleared when emptied.
      return { ...state, todos: action.items };

    case "api_retry": {
      const [rid, seq] = id(state, "r");
      const status = action.status ? ` (HTTP ${action.status})` : "";
      return {
        ...state,
        seq,
        items: [
          ...state.items,
          {
            kind: "notice",
            id: rid,
            level: "warn",
            message: `Model call failed${status}; retrying (attempt ${action.attempt}/${action.maxRetries})…`,
          },
        ],
      };
    }

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

/** Rebuild scrollback items from a persisted transcript (for --resume / --continue). */
function hydrateItems(startSeq: number, messages: TranscriptMessage[]): { items: Item[]; seq: number } {
  const items: Item[] = [];
  const toolIndex = new Map<string, number>();
  let seq = startSeq;
  for (const m of messages) {
    if (m.role === "user") {
      items.push({ kind: "user", id: `u${++seq}`, text: m.content });
    } else if (m.role === "assistant") {
      if (m.content) {
        items.push({ kind: "assistant", id: `a${++seq}`, text: m.content, streaming: false });
      }
      for (const c of m.toolCalls) {
        toolIndex.set(c.id, items.length);
        items.push({ kind: "tool", id: c.id, name: c.name, status: "running", input: c.input });
      }
    } else if (m.role === "tool") {
      for (const r of m.results) {
        const idx = toolIndex.get(r.toolUseId);
        const it = idx === undefined ? undefined : items[idx];
        if (idx !== undefined && it && it.kind === "tool") {
          items[idx] = { ...it, status: r.isError ? "error" : "ok", summary: firstLine(r.content) };
        }
      }
    } else if (m.role === "summary") {
      items.push({ kind: "compact", id: `c${++seq}`, reason: "resumed from a compacted session" });
    }
  }
  return { items, seq };
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
