/**
 * The single React binding between the renderer and the main process: a useReducer over the
 * pure reducer, an onAgentEvent subscription that dispatches the event stream, and bound
 * action creators that call the whitelisted window.blazecoder IPC surface. Components never
 * touch IPC directly — they receive state slices and these callbacks.
 */

import { useCallback, useEffect, useReducer, useState } from "react";
import { reduce } from "./reducer";
import { initialUiState } from "./types";
import type { Effort } from "../../shared/ipc";
import type { DesktopProject } from "../../shared/ipc";
import type { RuleSource, SessionSummary } from "@blazecoder/shared";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useAgentStore() {
  const [state, dispatch] = useReducer(reduce, initialUiState);
  const [project, setProject] = useState<DesktopProject | undefined>(undefined);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [effort, setEffort] = useState<Effort>("high");
  const [error, setError] = useState<string | undefined>(undefined);

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await window.blazecoder.listSessions());
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    void window.blazecoder.getProject().then((p) => {
      if (p) {
        setProject(p);
        void refreshSessions();
      }
    });
    const unsubscribe = window.blazecoder.onAgentEvent((event) => dispatch(event));
    return unsubscribe;
  }, [refreshSessions]);

  const attach = useCallback(
    async (open: () => Promise<DesktopProject | undefined>) => {
      setError(undefined);
      try {
        const p = await open();
        if (!p) return;
        setProject(p);
        dispatch({ type: "reset" });
        await refreshSessions();
      } catch (e) {
        setError(message(e));
      }
    },
    [refreshSessions],
  );

  const openProjectDialog = useCallback(() => attach(() => window.blazecoder.openProjectDialog()), [attach]);
  const openProjectPath = useCallback(
    (cwd: string) => attach(() => window.blazecoder.openProjectPath(cwd)),
    [attach],
  );

  const run = useCallback(
    async (prompt: string) => {
      const text = prompt.trim();
      if (!text || !project || state.status !== "idle") return;
      setError(undefined);
      dispatch({ type: "user_prompt", text });
      let failed = false;
      try {
        await window.blazecoder.runAgent({ prompt: text, sessionId: state.sessionId, effort });
        await refreshSessions();
      } catch (e) {
        failed = true;
        setError(message(e));
      } finally {
        // On a thrown run, settle with error so any streamed-but-unexecuted tool row is marked
        // interrupted rather than spinning forever.
        dispatch({ type: "run_settled", error: failed });
      }
    },
    [project, state.status, state.sessionId, effort, refreshSessions],
  );

  const abort = useCallback(async () => {
    await window.blazecoder.abortAgent();
    dispatch({ type: "run_settled", error: true });
  }, []);

  const resolvePermission = useCallback(
    async (behavior: "allow" | "deny", persist?: RuleSource) => {
      const requestId = state.permission?.requestId;
      if (!requestId) return;
      dispatch({ type: "permission_resolved" }); // clear the modal optimistically
      try {
        await window.blazecoder.resolvePermission({ requestId, behavior, persist });
      } catch (e) {
        setError(message(e));
      }
    },
    [state.permission],
  );

  const loadSession = useCallback(
    async (id: string) => {
      // Never hydrate over a live run: it would fold the running session's events into the wrong
      // timeline and, if a permission were parked, strand the UI (modal cleared, no abort affordance).
      if (state.status !== "idle") return;
      setError(undefined);
      try {
        const session = await window.blazecoder.getSession(id);
        if (session) dispatch({ type: "hydrate", session });
      } catch (e) {
        setError(message(e));
      }
    },
    [state.status],
  );

  const compact = useCallback(async () => {
    if (!project || state.status !== "idle") return;
    setError(undefined);
    try {
      await window.blazecoder.compactSession(state.sessionId);
    } catch (e) {
      setError(message(e));
    }
  }, [project, state.status, state.sessionId]);

  const selectTool = useCallback((toolUseId: string) => dispatch({ type: "select_tool", toolUseId }), []);

  const openExternal = useCallback((url: string) => {
    void window.blazecoder.openExternal(url);
  }, []);

  return {
    state,
    project,
    sessions,
    effort,
    error,
    setEffort,
    actions: {
      openProjectDialog,
      openProjectPath,
      run,
      abort,
      resolvePermission,
      loadSession,
      refreshSessions,
      compact,
      selectTool,
      openExternal,
    },
  };
}

export type AgentStore = ReturnType<typeof useAgentStore>;
