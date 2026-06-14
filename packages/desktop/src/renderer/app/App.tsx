import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { useAgentStore } from "./useAgentStore";
import type { ToolItem } from "./types";
import { TopBar } from "../components/TopBar";
import { Sidebar } from "../components/Sidebar";
import { Timeline } from "../components/Timeline";
import { Inspector } from "../components/Inspector";
import { Composer } from "../components/Composer";
import { PermissionDialog } from "../components/PermissionDialog";
import { ProjectPicker } from "../components/ProjectPicker";

export function App() {
  const { state, project, sessions, effort, error, setEffort, actions } = useAgentStore();

  const changedTools = useMemo(
    () => state.timeline.filter((i): i is ToolItem => i.kind === "tool" && i.diff !== undefined),
    [state.timeline],
  );
  const selectedTool = useMemo(
    () => state.timeline.find((i): i is ToolItem => i.kind === "tool" && i.toolUseId === state.selectedToolId),
    [state.timeline, state.selectedToolId],
  );
  const latestDiffTool = changedTools.length > 0 ? changedTools[changedTools.length - 1] : undefined;
  const diffTool = selectedTool?.diff ? selectedTool : latestDiffTool;

  if (!project) {
    return <ProjectPicker onOpenDialog={actions.openProjectDialog} onOpenPath={actions.openProjectPath} />;
  }

  return (
    <div className="app">
      <TopBar
        cwd={project.cwd}
        model={state.model ?? project.model}
        permissionMode={project.permissionMode}
        effort={effort}
        onEffort={setEffort}
        budget={state.budget}
        status={state.status}
        onCompact={actions.compact}
        canCompact={state.status === "idle"}
      />
      <div className="app__body">
        <Sidebar
          sessions={sessions}
          activeSessionId={state.sessionId}
          onLoadSession={actions.loadSession}
          onRefresh={actions.refreshSessions}
          changedTools={changedTools}
          selectedToolId={state.selectedToolId}
          onSelectTool={actions.selectTool}
          busy={state.status !== "idle"}
        />
        <main className="center">
          {error ? (
            <div className="errorbar">
              <AlertTriangle size={15} strokeWidth={1.75} />
              <span>{error}</span>
            </div>
          ) : null}
          <Timeline items={state.timeline} selectedToolId={state.selectedToolId} onSelectTool={actions.selectTool} busy={state.status === "running"} />
          <Composer status={state.status} ready onSend={actions.run} onAbort={actions.abort} />
        </main>
        <Inspector diffTool={diffTool} inspectTool={selectedTool} todos={state.todos} />
      </div>
      {state.permission ? <PermissionDialog prompt={state.permission} onResolve={actions.resolvePermission} /> : null}
    </div>
  );
}
