/**
 * Owns a run's lifecycle: holds the reduced UI state, records the user's prompt,
 * streams events from the backend, supports abort, and relays permission
 * decisions. This is the only place the UI touches the transport - features and
 * layout stay pure-presentational.
 */

import { useCallback, useReducer, useRef, useState } from "react";
import {
  applyEvent,
  initialState,
  type AgentUiState,
  type PendingPermission,
  type UiStatus,
} from "@/lib/agentState";
import { runAgent } from "@/lib/eventStream";
import { postPermission } from "@/lib/api";

export interface AgentRun {
  state: AgentUiState;
  /** Network activity in flight (request open, including while awaiting a decision). */
  busy: boolean;
  /** Effective status for the UI indicator (collapses a stopped run back to idle). */
  phase: UiStatus;
  run: (prompt: string) => Promise<void>;
  stop: () => void;
  decide: (behavior: "allow" | "deny") => Promise<void>;
}

export function useAgentRun(): AgentRun {
  const [state, dispatch] = useReducer(applyEvent, initialState);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Mirror latest values so the stable callbacks never read stale closures.
  const sessionRef = useRef<string | undefined>(undefined);
  sessionRef.current = state.sessionId;
  const pendingRef = useRef<PendingPermission | undefined>(undefined);
  pendingRef.current = state.pendingPermission;
  const busyRef = useRef(false);
  busyRef.current = busy;

  const run = useCallback(async (prompt: string) => {
    const text = prompt.trim();
    if (!text || busyRef.current) return;
    dispatch({ type: "user_prompt", text });
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await runAgent({ prompt: text, sessionId: sessionRef.current }, dispatch, controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) {
        dispatch({
          type: "notice",
          level: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const decide = useCallback(async (behavior: "allow" | "deny") => {
    const pending = pendingRef.current;
    if (!pending) return;
    await postPermission({ requestId: pending.requestId, behavior });
  }, []);

  const phase: UiStatus = busy
    ? state.status === "awaiting_permission"
      ? "awaiting_permission"
      : "running"
    : state.status === "running"
      ? "idle" // stopped without a terminal event
      : state.status;

  return { state, busy, phase, run, stop, decide };
}
