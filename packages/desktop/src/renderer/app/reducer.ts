/**
 * The pure renderer reducer: (UiState, AgentEvent | UiAction) -> UiState. This is the
 * contract bridge — all event-handling logic lives here, components just render the
 * result. Types-only imports (no React/Electron), so it is unit-tested headless and is
 * the primary regression net for the GUI.
 *
 * It is a deliberate sibling of the TUI reducer (cli/src/tui/state.ts:applyEvent) keyed to
 * the same AgentEvent contract: same liveAssistantId streaming/ordering semantics, same
 * tool upsert-by-toolUseId, same file_change diff attachment. Divergences are intentional
 * for a GUI: the reasoning trace IS surfaced, sub-agents get their own rows, and
 * tool_args_delta (raw arg JSON, no toolUseId) is dropped entirely.
 */

import type { AgentEvent, SessionState, ToolCall } from "@blazecoder/shared";
import { transcriptToTimeline } from "./transcript";
import { initialUiState } from "./types";
import type { AssistantItem, ToolItem, UiState } from "./types";

export type UiAction =
  | AgentEvent
  | { type: "user_prompt"; text: string }
  | { type: "hydrate"; session: SessionState }
  | { type: "select_tool"; toolUseId: string }
  | { type: "permission_resolved" }
  | { type: "run_settled"; error?: boolean }
  | { type: "reset" };

export function reduce(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case "reset":
      return { ...initialUiState, model: state.model };

    case "user_prompt": {
      const seq = state.seq + 1;
      return {
        ...state,
        seq,
        status: "running",
        permission: null,
        liveAssistantId: undefined,
        timeline: [...state.timeline, { id: `u${seq}`, kind: "user", text: action.text }],
      };
    }

    case "hydrate":
      return {
        ...state,
        timeline: transcriptToTimeline(action.session.messages),
        status: "idle",
        permission: null,
        liveAssistantId: undefined,
        selectedToolId: undefined,
        sessionId: action.session.id,
        model: action.session.model,
      };

    case "select_tool":
      return { ...state, selectedToolId: action.toolUseId };

    case "permission_resolved":
      // The user answered; clear the modal optimistically — the loop resumes and streams more.
      return { ...state, status: "running", permission: null };

    case "run_settled":
      return settle(state, action.error ?? false);

    case "system":
      return {
        ...state,
        sessionId: action.sessionId,
        model: action.model,
        budget: { totalTokens: action.contextTokens, usedTokens: 0, remainingTokens: action.contextTokens },
      };

    case "assistant_delta":
      return appendToAssistant(state, action.text, "text");

    case "reasoning_delta":
      return appendToAssistant(state, action.text, "reasoning");

    case "tool_args_delta":
      // Raw tool-argument JSON (a streaming file body). It has no toolUseId and is
      // contractually non-rendered — drop it from the timeline.
      return state;

    case "assistant":
      return finalizeAssistant(state, action.text, action.reasoning ?? "", action.toolCalls);

    case "tool_call": {
      if (state.timeline.some((i) => i.kind === "tool" && i.toolUseId === action.id)) {
        return { ...state, selectedToolId: action.id };
      }
      const item: ToolItem = { id: `tool-${action.id}`, kind: "tool", toolUseId: action.id, name: action.name, input: action.input };
      return { ...state, selectedToolId: action.id, timeline: [...state.timeline, item] };
    }

    case "tool_result":
      return patchTool(state, action.toolUseId, (t) => ({
        ...t,
        output: action.content,
        isError: action.isError,
        durationMs: action.durationMs,
      }));

    case "file_change":
      if (!action.toolUseId) return state;
      return patchTool(state, action.toolUseId, (t) => ({ ...t, diff: action.diff, filePath: action.path, op: action.op }));

    case "budget":
      return {
        ...state,
        budget: { totalTokens: action.totalTokens, usedTokens: action.usedTokens, remainingTokens: action.remainingTokens },
      };

    case "todos":
      return { ...state, todos: action.items };

    case "subagent":
      return reduceSubagent(state, action);

    case "compact_boundary": {
      const seq = state.seq + 1;
      const text = `Compacted context · ${action.tokensBefore.toLocaleString()} → ${action.tokensAfter.toLocaleString()} tokens`;
      return { ...state, seq, timeline: [...state.timeline, { id: `b${seq}`, kind: "boundary", text }] };
    }

    case "api_retry": {
      const seq = state.seq + 1;
      const status = action.status ? ` (HTTP ${action.status})` : "";
      const text = `Model call failed${status}; retrying ${action.attempt}/${action.maxRetries}…`;
      return { ...state, seq, timeline: [...state.timeline, { id: `n${seq}`, kind: "notice", level: "warn", text }] };
    }

    case "permission_request":
      return {
        ...state,
        status: "awaiting_permission",
        permission: {
          requestId: action.requestId,
          toolName: action.toolName,
          reason: action.reason,
          input: action.input,
          suggestions: action.suggestions ?? [],
          risk: action.risk,
        },
      };

    case "notice": {
      const seq = state.seq + 1;
      return { ...state, seq, timeline: [...state.timeline, { id: `n${seq}`, kind: "notice", level: action.level, text: action.message }] };
    }

    case "result": {
      // An error/cap subtype (max_turns, max_budget, error_during_execution, …) means tool rows
      // may have been streamed but never executed — interrupt them rather than spin forever.
      // success ends with zero pending rows; cancelled already settled with error via abort.
      const errored = action.subtype !== "success" && action.subtype !== "cancelled";
      const settled = settle(state, errored);
      const seq = settled.seq + 1;
      const text = action.summary ? `${action.subtype} · ${action.summary}` : action.subtype;
      return {
        ...settled,
        seq,
        sessionId: action.sessionId,
        timeline: [...settled.timeline, { id: `b${seq}`, kind: "boundary", text }],
      };
    }

    default:
      return state;
  }
}

/** Convenience folder for tests and session replay. */
export function reduceAll(actions: UiAction[], from: UiState = initialUiState): UiState {
  return actions.reduce(reduce, from);
}

function appendToAssistant(state: UiState, text: string, field: "text" | "reasoning"): UiState {
  const live = state.timeline.find(
    (i): i is AssistantItem => i.kind === "assistant" && i.id === state.liveAssistantId && !i.complete,
  );
  if (live) {
    return {
      ...state,
      timeline: state.timeline.map((i) =>
        i.id === live.id && i.kind === "assistant"
          ? {
              ...i,
              text: field === "text" ? i.text + text : i.text,
              reasoning: field === "reasoning" ? i.reasoning + text : i.reasoning,
            }
          : i,
      ),
    };
  }
  // No open assistant (out-of-order / post-compaction safe): open one.
  const seq = state.seq + 1;
  const item: AssistantItem = {
    id: `a${seq}`,
    kind: "assistant",
    text: field === "text" ? text : "",
    reasoning: field === "reasoning" ? text : "",
    complete: false,
  };
  return { ...state, seq, liveAssistantId: `a${seq}`, timeline: [...state.timeline, item] };
}

function finalizeAssistant(state: UiState, text: string, reasoning: string, toolCalls: ToolCall[]): UiState {
  let timeline = state.timeline;
  let seq = state.seq;
  const live = timeline.find(
    (i): i is AssistantItem => i.kind === "assistant" && i.id === state.liveAssistantId && !i.complete,
  );
  if (live) {
    timeline = timeline.map((i) =>
      i.id === live.id && i.kind === "assistant"
        ? { ...i, text: i.text || text, reasoning: i.reasoning || reasoning, complete: true }
        : i,
    );
  } else if (text || reasoning) {
    seq += 1;
    timeline = [...timeline, { id: `a${seq}`, kind: "assistant", text, reasoning, complete: true }];
  }
  // A tool_call arriving before this `assistant` event already created the row; create any
  // that didn't (toolUseId dedup), so finalize and stream order both converge.
  for (const c of toolCalls) {
    if (!timeline.some((i) => i.kind === "tool" && i.toolUseId === c.id)) {
      timeline = [...timeline, { id: `tool-${c.id}`, kind: "tool", toolUseId: c.id, name: c.name, input: c.input }];
    }
  }
  return { ...state, seq, liveAssistantId: undefined, timeline };
}

function patchTool(state: UiState, toolUseId: string, patch: (t: ToolItem) => ToolItem): UiState {
  return {
    ...state,
    timeline: state.timeline.map((i) => (i.kind === "tool" && i.toolUseId === toolUseId ? patch(i) : i)),
  };
}

function reduceSubagent(state: UiState, action: Extract<AgentEvent, { type: "subagent" }>): UiState {
  if (action.phase === "start") {
    // Each start is a distinct sub-agent. Use a unique seq id (NOT agentType+description, which
    // the model can repeat) so two similarly-labeled Task calls never collide on a React key.
    const seq = state.seq + 1;
    return {
      ...state,
      seq,
      timeline: [...state.timeline, { id: `sub${seq}`, kind: "subagent", agentType: action.agentType, description: action.description, running: true }],
    };
  }
  // end: mark the LAST still-running sub-agent with the same type+description complete.
  let lastIdx = -1;
  state.timeline.forEach((i, idx) => {
    if (i.kind === "subagent" && i.running && i.agentType === action.agentType && i.description === action.description) lastIdx = idx;
  });
  if (lastIdx >= 0) {
    const timeline = state.timeline.map((i, idx) =>
      idx === lastIdx && i.kind === "subagent" ? { ...i, running: false, summary: action.summary } : i,
    );
    return { ...state, timeline };
  }
  // An `end` with no matching `start` (e.g. resumed mid-flight): record a finished row.
  const seq = state.seq + 1;
  return {
    ...state,
    seq,
    timeline: [...state.timeline, { id: `sub${seq}`, kind: "subagent", agentType: action.agentType, description: action.description, running: false, summary: action.summary }],
  };
}

/**
 * Force the UI to a clean idle state at a terminal transition (result, abort, or a run
 * that threw mid-stream): finalize any still-streaming assistant, and on an error/abort
 * mark any unfinished tool row as interrupted — so the UI never hangs in running/pending.
 */
function settle(state: UiState, error: boolean): UiState {
  const timeline = state.timeline.map((i) => {
    if (i.kind === "assistant" && !i.complete) return { ...i, complete: true };
    if (error && i.kind === "tool" && i.output === undefined) return { ...i, isError: true, output: "(interrupted)" };
    return i;
  });
  return { ...state, status: "idle", permission: null, liveAssistantId: undefined, timeline };
}
