import { ArrowsIn, ListBullets } from "@phosphor-icons/react";
import type { TraceEntry } from "@/lib/agentState";
import { toolMeta } from "@/lib/toolMeta";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Badge, EmptyState, Spinner, StatusDot, type Tone } from "@/ui";
import { ToolIcon } from "@/components/ToolIcon";

/**
 * The raw event log: a power-user timeline that complements the conversation
 * view. Every model turn, tool call, notice, and compaction lands here as one
 * dense, legible row threaded onto a vertical connector hairline.
 *
 * Purely presentational - props in, JSX out.
 */
export function TracePanel({ trace }: { trace: TraceEntry[] }) {
  if (trace.length === 0) {
    return (
      <EmptyState
        icon={<ListBullets size={28} weight="regular" />}
        title="No activity yet"
        hint="Every model turn, tool call, and compaction is logged here."
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3">
      <ol className="space-y-0">
        {trace.map((entry, i) => (
          <TraceRow
            key={entry.id}
            entry={entry}
            first={i === 0}
            last={i === trace.length - 1}
          />
        ))}
      </ol>
    </div>
  );
}

function TraceRow({
  entry,
  first,
  last,
}: {
  entry: TraceEntry;
  first: boolean;
  last: boolean;
}) {
  return (
    <li className="flex gap-2">
      <Marker entry={entry} first={first} last={last} />
      <div className="min-w-0 flex-1 pb-3 text-[12.5px]">
        <Content entry={entry} />
      </div>
    </li>
  );
}

/**
 * Fixed left column carrying the connector hairline plus a centered marker.
 * The hairline spans the full row height but is trimmed at the very top of the
 * first row and the very bottom of the last so the thread does not dangle.
 */
function Marker({
  entry,
  first,
  last,
}: {
  entry: TraceEntry;
  first: boolean;
  last: boolean;
}) {
  return (
    <div className="relative flex w-6 shrink-0 justify-center">
      <span
        aria-hidden
        className={cn(
          "absolute left-1/2 w-px -translate-x-1/2 border-l border-border",
          first ? "top-3" : "top-0",
          last ? "bottom-[calc(100%-0.75rem)]" : "bottom-0",
        )}
      />
      <span className="relative z-10 mt-1.5 flex items-center justify-center bg-bg">
        <Glyph entry={entry} />
      </span>
    </div>
  );
}

function Glyph({ entry }: { entry: TraceEntry }) {
  switch (entry.kind) {
    case "assistant":
      return <StatusDot tone="accent" />;
    case "user":
      return <StatusDot tone="neutral" />;
    case "tool":
      if (entry.status === "running") return <Spinner size={12} />;
      if (entry.status === "error") return <StatusDot tone="danger" />;
      return <StatusDot tone="success" />;
    case "notice":
      return <StatusDot tone={noticeTone(entry.level)} />;
    case "compact":
      return <ArrowsIn size={13} weight="bold" className="text-info-text" />;
  }
}

function Content({ entry }: { entry: TraceEntry }) {
  switch (entry.kind) {
    case "user":
      return (
        <div className="space-y-0.5 py-1.5">
          <p className="text-[11px] text-subtle">You</p>
          <p className="line-clamp-2 text-text">{entry.text}</p>
        </div>
      );

    case "assistant":
      return (
        <div className="space-y-0.5 py-1.5">
          <p className="text-[11px] text-accent-text">Agent</p>
          <p className="line-clamp-3 whitespace-pre-wrap text-text">{entry.text}</p>
        </div>
      );

    case "tool":
      return <ToolRow entry={entry} />;

    case "notice":
      return (
        <div className="flex items-start gap-2 py-1.5">
          <Badge tone={noticeTone(entry.level)}>{entry.level ?? "info"}</Badge>
          <span className="min-w-0 text-muted">{entry.text}</span>
        </div>
      );

    case "compact":
      return <p className="py-1.5 text-info-text">Context compacted</p>;
  }
}

function ToolRow({ entry }: { entry: TraceEntry }) {
  const meta = toolMeta(entry.toolName ?? "", entry.input);
  const hasDuration = entry.durationMs != null;

  return (
    <div className="flex items-center gap-2 py-1.5">
      <ToolIcon
        name={meta.icon}
        size={13}
        weight="regular"
        className="shrink-0 text-subtle"
      />
      <span className="shrink-0 font-medium text-text">{meta.label}</span>
      {meta.detail && (
        <span className="min-w-0 truncate font-mono text-[11px] text-subtle">
          {meta.detail}
        </span>
      )}
      {entry.status === "error" && (
        <Badge tone="danger" className="shrink-0">
          error
        </Badge>
      )}
      {hasDuration && (
        <span className="ml-auto shrink-0 pl-2 text-[11px] text-faint tnum">
          {formatDuration(entry.durationMs as number)}
        </span>
      )}
    </div>
  );
}

function noticeTone(level: TraceEntry["level"]): Tone {
  if (level === "warn") return "warn";
  if (level === "error") return "danger";
  return "info";
}
