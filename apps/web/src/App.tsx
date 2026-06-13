import { useReducer, useRef, useState } from "react";
import type { AgentEvent } from "@coding-agent/shared";
import { applyEvent, fileList, initialState } from "./lib/agentState";
import { runAgent } from "./lib/eventStream";
import { postPermission } from "./lib/api";
import { exportProjectZip } from "./lib/exportProject";
import { Composer } from "./features/chat/Composer";
import { TracePanel } from "./features/trace/TracePanel";
import { PreviewPane } from "./features/preview/PreviewPane";
import { CodeView, FileExplorer } from "./features/fileTree/FileExplorer";
import { BudgetGauge } from "./features/budgetGauge/BudgetGauge";

export function App() {
  const [state, dispatch] = useReducer(applyEvent, initialState);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | undefined>();
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const abortRef = useRef<AbortController | null>(null);

  const files = fileList(state);
  const activeSelected =
    selected && state.files[selected]
      ? selected
      : state.files["/src/App.tsx"]
        ? "/src/App.tsx"
        : files[0]?.path;
  const activeFile = activeSelected ? state.files[activeSelected] : undefined;

  async function onRun(prompt: string) {
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await runAgent({ prompt, sessionId: state.sessionId }, (e: AgentEvent) => dispatch(e), controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) {
        dispatch({ type: "notice", level: "error", message: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      setBusy(false);
    }
  }

  async function decide(behavior: "allow" | "deny") {
    const pending = state.pendingPermission;
    if (!pending) return;
    await postPermission({ requestId: pending.requestId, behavior });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">⌘ Coding Agent</div>
        <div className="topbar-right">
          <BudgetGauge budget={state.budget} />
          <span className={`status status-${state.status}`}>{state.status}</span>
          {busy && (
            <button className="ghost-btn" onClick={() => abortRef.current?.abort()}>
              Stop
            </button>
          )}
          <button className="ghost-btn" disabled={files.length === 0} onClick={() => void exportProjectZip(state.sessionId ?? "project", files)}>
            Export .zip
          </button>
        </div>
      </header>

      {state.pendingPermission && (
        <div className="permission-banner">
          <span>
            Allow <strong>{state.pendingPermission.toolName}</strong>? {state.pendingPermission.reason}
          </span>
          <span className="permission-actions">
            <button className="run-btn" onClick={() => void decide("allow")}>Allow</button>
            <button className="ghost-btn" onClick={() => void decide("deny")}>Deny</button>
          </span>
        </div>
      )}

      <main className="layout">
        <section className="col col-left">
          <div className="col-head">Activity</div>
          <div className="col-body scroll">
            <TracePanel trace={state.trace} />
            {state.resultSummary && <div className="result-summary">{state.resultSummary}</div>}
          </div>
          <Composer disabled={busy} onSubmit={onRun} />
        </section>

        <section className="col col-center">
          <div className="tabbar">
            <button className={tab === "preview" ? "tab active" : "tab"} onClick={() => setTab("preview")}>
              Preview
            </button>
            <button className={tab === "code" ? "tab active" : "tab"} onClick={() => setTab("code")}>
              Code
            </button>
          </div>
          <div className="col-body">
            {tab === "preview" ? (
              <PreviewPane html={state.previewHtml} error={state.previewError} />
            ) : (
              <CodeView file={activeFile} />
            )}
          </div>
        </section>

        <section className="col col-right">
          <div className="col-head">Files</div>
          <div className="col-body scroll">
            <FileExplorer
              files={files}
              selected={activeSelected}
              onSelect={(p) => {
                setSelected(p);
                setTab("code");
              }}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
