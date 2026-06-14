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

import type { AgentEvent, ContextReport, FileDiff, SessionState, TodoItem, TranscriptMessage } from "@zephyrcode/shared";

export type ToolStatus = "running" | "ok" | "error";

export type Item =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string; streaming: boolean }
  | { kind: "tool"; id: string; name: string; status: ToolStatus; input: Record<string, unknown>; summary?: string; durationMs?: number; diff?: FileDiff }
  | { kind: "notice"; id: string; level: "info" | "warn" | "error"; message: string }
  | { kind: "compact"; id: string; reason: string }
  | { kind: "context"; id: string; report: ContextReport }
  | { kind: "result"; id: string; subtype: string; summary: string };

export interface PendingPermission {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  reason: string;
  /** "Always allow" rule strings the user can persist (local/project). */
  suggestions?: string[];
  /** Risk assessment for a Bash command (advisory display). */
  risk?: { level: "read" | "write" | "network" | "destructive"; category: string; reason: string };
}

export type RunStatus = "idle" | "running" | "awaiting_permission" | "done" | "error";

export interface TuiState {
  items: Item[];
  status: RunStatus;
  model?: string;
  effort: string;
  /** The active output style name, if any (mirrors runtime.outputStyle; shown on the input rule). */
  outputStyle?: string;
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
  /**
   * Bumped on hydrate (/resume) and reset (/clear). The view re-keys its <Static> on this
   * so the committed-scrollback list restarts cleanly (and the screen is wiped) instead of
   * the new transcript appending under the old one.
   */
  epoch: number;
}

export type UiAction =
  | AgentEvent
  | { type: "user_prompt"; text: string }
  | { type: "set_effort"; effort: string }
  | { type: "set_output_style"; style?: string }
  | { type: "permission_resolved" }
  | { type: "context_report"; report: ContextReport }
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
    epoch: 0,
  };
}

/** True once an item is finalized (it won't change again) and is safe to commit to <Static>. */
export function isFinalItem(item: Item): boolean {
  if (item.kind === "assistant") return !item.streaming;
  if (item.kind === "tool") return item.status !== "running";
  return true; // user · notice · compact · result are final the moment they appear
}

/**
 * Split scrollback at the FIRST non-final item: everything before it is committed
 * (printed once via <Static>, so it scrolls into native terminal history — no repaint,
 * no flicker, scrollable), and the rest is the live tail (a streaming reply / running
 * tools) rendered in the dynamic region. Splitting at the first non-final item — rather
 * than filtering — keeps visual order correct even when a later tool finishes first.
 */
export function splitItems(items: Item[]): { committed: Item[]; live: Item[] } {
  let i = 0;
  while (i < items.length && isFinalItem(items[i]!)) i++;
  return { committed: items.slice(0, i), live: items.slice(i) };
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
      // The output style is a runtime-level setting; it survives a /clear. Bump epoch so
      // <Static> restarts (the cleared screen shows a fresh, empty transcript).
      return { ...initialState(state.effort), model: state.model, outputStyle: state.outputStyle, epoch: state.epoch + 1 };

    case "set_effort":
      return { ...state, effort: action.effort };

    case "set_output_style":
      return { ...state, outputStyle: action.style };

    case "permission_resolved":
      // The user answered the prompt; the loop resumes and will emit more events.
      return { ...state, status: "running", permission: undefined };

    case "hydrate": {
      const { items, seq } = hydrateItems(state.seq, action.session.messages);
      // Bump epoch so <Static> re-keys and reprints the resumed transcript fresh; the view
      // wipes the screen first so it replaces (never stacks on) whatever was shown. The
      // initial print is bounded so resuming a very long session doesn't dump 10k lines.
      return { ...state, items: cap(items), seq, model: action.session.model, status: "done", turnChars: 0, epoch: state.epoch + 1 };
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
        // No cap here: committed items feed an append-only <Static>, so the prefix must
        // only ever grow within a session (trimming it would make <Static> reprint).
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

    case "tool_args_delta":
      // Tool-call argument JSON (e.g. a file body) is counted but never rendered, so the
      // live token gauge climbs continuously while a Write/Edit is being generated.
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

    case "subagent": {
      const [sid, seq] = id(state, "s");
      const message =
        action.phase === "start"
          ? `↳ delegating to ${action.agentType}: ${action.description}`
          : `↳ ${action.agentType} finished (${action.turns ?? 0} turn${action.turns === 1 ? "" : "s"})`;
      return { ...state, seq, items: [...state.items, { kind: "notice", id: sid, level: "info", message }] };
    }

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
          suggestions: action.suggestions,
          risk: action.risk,
        },
      };

    case "notice": {
      const [nid, seq] = id(state, "n");
      return { ...state, seq, items: [...state.items, { kind: "notice", id: nid, level: action.level, message: action.message }] };
    }

    case "context_report": {
      const [cid, seq] = id(state, "ctx");
      return { ...state, seq, items: [...state.items, { kind: "context", id: cid, report: action.report }] };
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

    case "file_change": {
      // Attach the structured diff to the exact tool row that produced it (by toolUseId),
      // so the ToolView can render a git-style block beneath that row.
      if (!action.diff || !action.toolUseId) return state;
      const { toolUseId, diff } = action;
      return {
        ...state,
        items: state.items.map((i) => (i.id === toolUseId && i.kind === "tool" ? { ...i, diff } : i)),
      };
    }

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
      // A synthetic rehydration message carries full file bodies for the MODEL only —
      // never replay it as a user item (that leaked the whole file onto the screen).
      if (m.synthetic === "rehydrated_files") {
        items.push({ kind: "compact", id: `c${++seq}`, reason: "restored file context after compaction" });
      } else {
        items.push({ kind: "user", id: `u${++seq}`, text: m.content });
      }
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
