import { useEffect, useRef } from "react";
import { AlertTriangle, Check, GitBranch, Info, Loader2, X } from "lucide-react";
import type { AssistantItem, NoticeItem, SubagentItem, TimelineItem, ToolItem } from "../app/types";
import { shortPath, toolDetail, toolGlyph } from "../app/format";

export function Timeline({
  items,
  selectedToolId,
  onSelectTool,
  busy,
}: {
  items: TimelineItem[];
  selectedToolId?: string;
  onSelectTool: (id: string) => void;
  busy: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items.length, busy]);

  if (items.length === 0) {
    return (
      <div className="timeline timeline--empty">
        <div className="hint">
          <p className="hint__lead">Ready when you are.</p>
          <p className="hint__sub">Ask blazecoder to explore, change, test, or explain this workspace.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="timeline">
      {items.map((item) => (
        <Row key={item.id} item={item} selectedToolId={selectedToolId} onSelectTool={onSelectTool} />
      ))}
      {busy ? (
        <div className="working">
          <Loader2 className="spin" size={15} strokeWidth={2} />
          <span>working</span>
        </div>
      ) : null}
      <div ref={endRef} />
    </div>
  );
}

function Row({
  item,
  selectedToolId,
  onSelectTool,
}: {
  item: TimelineItem;
  selectedToolId?: string;
  onSelectTool: (id: string) => void;
}) {
  switch (item.kind) {
    case "user":
      return (
        <article className="msg msg--user">
          <div className="msg__body">{item.text}</div>
        </article>
      );
    case "assistant":
      return <AssistantRow item={item} />;
    case "tool":
      return <ToolRow item={item} selected={item.toolUseId === selectedToolId} onSelect={() => onSelectTool(item.toolUseId)} />;
    case "subagent":
      return <SubagentRow item={item} />;
    case "notice":
      return <NoticeRow item={item} />;
    case "boundary":
      return <div className="boundary">{item.text}</div>;
    default:
      return null;
  }
}

function AssistantRow({ item }: { item: AssistantItem }) {
  return (
    <article className="msg msg--assistant">
      {item.reasoning ? (
        <details className="reasoning">
          <summary>thinking</summary>
          <pre>{item.reasoning}</pre>
        </details>
      ) : null}
      <div className="msg__body">{item.text || (item.complete ? "" : "…")}</div>
    </article>
  );
}

function ToolRow({ item, selected, onSelect }: { item: ToolItem; selected: boolean; onSelect: () => void }) {
  const pending = item.output === undefined;
  const stateClass = pending ? "is-pending" : item.isError ? "is-error" : "is-done";
  const detail = toolDetail(item.name, item.input) || shortPath(item.filePath);
  return (
    <button className={`tool ${selected ? "is-selected" : ""}`} onClick={onSelect}>
      <span className="tool__glyph" aria-hidden>
        {toolGlyph(item.name)}
      </span>
      <span className="tool__name">{item.name}</span>
      <span className="tool__detail">{detail}</span>
      {item.diff ? (
        <span className="tool__delta">
          <span className="add">+{item.diff.added}</span>
          <span className="del">-{item.diff.removed}</span>
        </span>
      ) : null}
      <span className={`tool__state ${stateClass}`} aria-hidden>
        {pending ? <Loader2 className="spin" size={14} strokeWidth={2} /> : item.isError ? <X size={14} strokeWidth={2.25} /> : <Check size={14} strokeWidth={2.25} />}
      </span>
    </button>
  );
}

function SubagentRow({ item }: { item: SubagentItem }) {
  return (
    <div className={`subagent ${item.running ? "is-running" : ""}`}>
      <GitBranch size={14} strokeWidth={1.75} />
      <span className="subagent__type">{item.agentType}</span>
      <span className="subagent__desc">{item.description}</span>
      <span className="subagent__state">{item.running ? "running" : item.summary || "done"}</span>
    </div>
  );
}

function NoticeRow({ item }: { item: NoticeItem }) {
  const Icon = item.level === "error" ? AlertTriangle : item.level === "warn" ? AlertTriangle : Info;
  return (
    <div className={`notice notice--${item.level}`}>
      <Icon size={14} strokeWidth={1.75} />
      <span>{item.text}</span>
    </div>
  );
}
