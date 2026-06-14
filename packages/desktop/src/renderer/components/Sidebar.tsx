import { FileDiff, History, RefreshCw } from "lucide-react";
import type { SessionSummary } from "@zephyrcode/shared";
import type { ToolItem } from "../app/types";
import { shortPath } from "../app/format";

export function Sidebar({
  sessions,
  activeSessionId,
  onLoadSession,
  onRefresh,
  changedTools,
  selectedToolId,
  onSelectTool,
}: {
  sessions: SessionSummary[];
  activeSessionId?: string;
  onLoadSession: (id: string) => void;
  onRefresh: () => void;
  changedTools: ToolItem[];
  selectedToolId?: string;
  onSelectTool: (id: string) => void;
}) {
  const added = changedTools.reduce((n, t) => n + (t.diff?.added ?? 0), 0);
  const removed = changedTools.reduce((n, t) => n + (t.diff?.removed ?? 0), 0);

  return (
    <aside className="sidebar">
      <section className="panel">
        <div className="panel__head">
          <span className="panel__title">
            <FileDiff size={14} strokeWidth={1.75} />
            Changes
          </span>
          {changedTools.length > 0 ? (
            <span className="panel__stat">
              <span className="add">+{added}</span> <span className="del">-{removed}</span>
            </span>
          ) : null}
        </div>
        <div className="filelist">
          {changedTools.length === 0 ? (
            <p className="empty">No file changes yet.</p>
          ) : (
            changedTools.map((t) => (
              <button
                key={t.toolUseId}
                className={`filelist__item ${t.toolUseId === selectedToolId ? "is-active" : ""}`}
                onClick={() => onSelectTool(t.toolUseId)}
                title={t.filePath}
              >
                <span className="filelist__name">{shortPath(t.filePath)}</span>
                <span className="filelist__delta">
                  <span className="add">+{t.diff?.added ?? 0}</span>
                  <span className="del">-{t.diff?.removed ?? 0}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="panel panel--grow">
        <div className="panel__head">
          <span className="panel__title">
            <History size={14} strokeWidth={1.75} />
            Sessions
          </span>
          <button className="iconbtn" onClick={onRefresh} title="Refresh sessions" aria-label="Refresh sessions">
            <RefreshCw size={13} strokeWidth={1.75} />
          </button>
        </div>
        <div className="sessionlist">
          {sessions.length === 0 ? (
            <p className="empty">No saved sessions yet.</p>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                className={`sessionlist__item ${s.id === activeSessionId ? "is-active" : ""}`}
                onClick={() => onLoadSession(s.id)}
              >
                <span className="sessionlist__title">{s.title}</span>
                <span className="sessionlist__meta">{s.turns} turns</span>
              </button>
            ))
          )}
        </div>
      </section>
    </aside>
  );
}
