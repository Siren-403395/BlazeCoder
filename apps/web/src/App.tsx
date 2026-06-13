import { useEffect, useMemo, useState } from "react";
import { useAgentRun } from "@/hooks/useAgentRun";
import { useTheme } from "@/hooks/useTheme";
import { fileList, runStats, type UiStatus } from "@/lib/agentState";
import { buildConversation } from "@/lib/conversation";
import { exportProjectZip } from "@/lib/exportProject";
import { Header } from "@/layout/Header";
import { Workspace } from "@/layout/Workspace";
import { StatusBar } from "@/features/context/StatusBar";
import type { WorkTab } from "@/layout/WorkspacePanel";

const STATUS_LABEL: Record<UiStatus, string> = {
  idle: "Ready",
  running: "Working",
  awaiting_permission: "Awaiting permission",
  done: "Run complete",
  error: "Run failed",
};

export function App() {
  const { state, busy, phase, run, stop, decide, loadSession, newSession } = useAgentRun();
  const { resolved, toggle } = useTheme();
  const [tab, setTab] = useState<WorkTab>("preview");
  const [selected, setSelected] = useState<string | undefined>(undefined);
  // Capture any ?session= deep-link at first render, before the URL-sync effect runs.
  const [initialSession] = useState(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("session"),
  );

  const files = useMemo(() => fileList(state), [state.files]);
  const segments = useMemo(() => buildConversation(state.trace), [state.trace]);
  const stats = runStats(state);
  const building = useMemo(
    () =>
      state.trace.some(
        (t) => t.kind === "tool" && t.toolName === "build_preview" && t.status === "running",
      ),
    [state.trace],
  );

  // Resolve a sensible selected file: explicit pick, else the entry point, else first.
  const activeSelected =
    selected && state.files[selected]
      ? selected
      : state.files["/src/App.tsx"]
        ? "/src/App.tsx"
        : files[0]?.path;

  // Surface the preview as soon as one is built.
  useEffect(() => {
    if (state.previewHtml) setTab("preview");
  }, [state.previewHtml]);

  // Resume a deep-linked session on load; show its files first.
  useEffect(() => {
    if (initialSession) {
      loadSession(initialSession)
        .then(() => setTab("files"))
        .catch(() => {});
    }
  }, [initialSession, loadSession]);

  // Reflect the active session in the URL once it exists. We never strip the
  // param here, so a ?session= deep-link survives until hydrate resolves; it is
  // cleared only on an explicit New session.
  useEffect(() => {
    if (typeof window === "undefined" || !state.sessionId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("session", state.sessionId);
    window.history.replaceState(null, "", url);
  }, [state.sessionId]);

  const liveMessage = state.pendingPermission
    ? `Permission needed for ${state.pendingPermission.toolName}`
    : STATUS_LABEL[phase];

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <div
        className="sr-only"
        role="status"
        aria-live={state.pendingPermission || phase === "error" ? "assertive" : "polite"}
      >
        {liveMessage}
      </div>
      <Header
        phase={phase}
        model={state.model}
        sessionId={state.sessionId}
        resolvedTheme={resolved}
        onToggleTheme={toggle}
        onExport={() => void exportProjectZip(state.sessionId ?? "project", files)}
        canExport={files.length > 0}
        onSelectSession={(id) => {
          loadSession(id)
            .then(() => setTab("files"))
            .catch(() => {});
        }}
        onNewSession={() => {
          newSession();
          setSelected(undefined);
          setTab("preview");
          if (typeof window !== "undefined") {
            const url = new URL(window.location.href);
            url.searchParams.delete("session");
            window.history.replaceState(null, "", url);
          }
        }}
      />
      <Workspace
        segments={segments}
        phase={phase}
        onOpenFile={(path) => {
          setSelected(path);
          setTab("files");
        }}
        busy={busy}
        onRun={(prompt) => void run(prompt)}
        onStop={stop}
        pending={state.pendingPermission}
        onDecide={(behavior) => void decide(behavior)}
        tab={tab}
        onTab={setTab}
        previewHtml={state.previewHtml}
        previewError={state.previewError}
        building={building}
        files={files}
        selected={activeSelected}
        onSelect={(path) => setSelected(path)}
        trace={state.trace}
      />
      <StatusBar stats={stats} />
    </div>
  );
}
