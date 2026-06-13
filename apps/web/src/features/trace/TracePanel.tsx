import type { TraceEntry } from "../../lib/agentState";

export function TracePanel({ trace }: { trace: TraceEntry[] }) {
  if (trace.length === 0) {
    return <div className="pane-empty small">The agent's activity will appear here.</div>;
  }
  return (
    <div className="trace">
      {trace.map((entry) => (
        <div key={entry.id} className={`trace-entry trace-${entry.kind}${entry.isError ? " trace-err" : ""}`}>
          {entry.kind === "tool" && <span className="trace-tag">{entry.toolName}</span>}
          {entry.kind === "compact" && <span className="trace-tag">compact</span>}
          {entry.kind === "notice" && <span className="trace-tag">notice</span>}
          <span className="trace-text">{entry.text}</span>
        </div>
      ))}
    </div>
  );
}
