/**
 * The single React binding between the renderer and the main process: a useReducer over the
 * pure reducer, an onAgentEvent subscription that dispatches the event stream, and bound
 * action creators that call the whitelisted window.zephyrcode IPC surface. Components never
 * touch IPC directly — they receive state slices and these callbacks.
 */

import { useCallback, useEffect, useReducer, useState } from "react";
import { reduce } from "./reducer";
import { initialUiState } from "./types";
import type { Effort } from "../../shared/ipc";
import type { DesktopProject } from "../../shared/ipc";
import type { RuleSource, SessionSummary } from "@zephyrcode/shared";

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
      setSessions(await window.zephyrcode.listSessions());
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    void window.zephyrcode.getProject().then((p) => {
      if (p) {
        setProject(p);
        void refreshSessions();
      }
    });
    const unsubscribe = window.zephyrcode.onAgentEvent((event) => dispatch(event));
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

  const openProjectDialog = useCallback(() => attach(() => window.zephyrcode.openProjectDialog()), [attach]);
  const openProjectPath = useCallback(
    (cwd: string) => attach(() => window.zephyrcode.openProjectPath(cwd)),
    [attach],
  );

  const run = useCallback(
    async (prompt: string) => {
      const text = prompt.trim();
      if (!text || !project || state.status !== "idle") return;
      setError(undefined);
      dispatch({ type: "user_prompt", text });
      try {
        await window.zephyrcode.runAgent({ prompt: text, sessionId: state.sessionId, effort });
        await refreshSessions();
      } catch (e) {
        setError(message(e));
      } finally {
        dispatch({ type: "run_settled", error: false });
      }
    },
    [project, state.status, state.sessionId, effort, refreshSessions],
  );

  const abort = useCallback(async () => {
    await window.zephyrcode.abortAgent();
    dispatch({ type: "run_settled", error: true });
  }, []);

  const resolvePermission = useCallback(
    async (behavior: "allow" | "deny", persist?: RuleSource) => {
      const requestId = state.permission?.requestId;
      if (!requestId) return;
      dispatch({ type: "permission_resolved" }); // clear the modal optimistically
      try {
        await window.zephyrcode.resolvePermission({ requestId, behavior, persist });
      } catch (e) {
        setError(message(e));
      }
    },
    [state.permission],
  );

  const loadSession = useCallback(async (id: string) => {
    setError(undefined);
    try {
      const session = await window.zephyrcode.getSession(id);
      if (session) dispatch({ type: "hydrate", session });
    } catch (e) {
      setError(message(e));
    }
  }, []);

  const compact = useCallback(async () => {
    if (!project || state.status !== "idle") return;
    setError(undefined);
    try {
      await window.zephyrcode.compactSession(state.sessionId);
    } catch (e) {
      setError(message(e));
    }
  }, [project, state.status, state.sessionId]);

  const selectTool = useCallback((toolUseId: string) => dispatch({ type: "select_tool", toolUseId }), []);

  const openExternal = useCallback((url: string) => {
    void window.zephyrcode.openExternal(url);
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
