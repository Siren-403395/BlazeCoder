import { useState } from "react";
import { ArrowSquareOut, CaretRight, Check, X } from "@phosphor-icons/react";
import { Button, CodeBlock, Collapse, Spinner } from "@/ui";
import { ToolIcon } from "@/components/ToolIcon";
import { cn } from "@/lib/cn";
import { toolMeta } from "@/lib/toolMeta";
import { formatDuration } from "@/lib/format";
import type { TraceEntry } from "@/lib/agentState";

function StatusGlyph({ status }: { status?: TraceEntry["status"] }) {
  if (status === "running") return <Spinner size={13} />;
  if (status === "error") return <X size={13} weight="bold" className="text-danger-text" />;
  return <Check size={13} weight="bold" className="text-success-text" />;
}

export function ActivityItem({
  entry,
  onOpenFile,
}: {
  entry: TraceEntry;
  onOpenFile?: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const meta = toolMeta(entry.toolName ?? "tool", entry.input);
  const path = typeof entry.input?.path === "string" ? entry.input.path : undefined;
  const canOpen = !!onOpenFile && !!path && meta.openable;

  return (
    <div className="overflow-hidden rounded-control border border-border bg-surface-2/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex h-8 w-full items-center gap-2 px-2.5 text-left hover:bg-surface-2"
      >
        <ToolIcon name={meta.icon} size={14} className="shrink-0 text-muted" />
        <span className="shrink-0 text-[12px] font-medium text-text">{meta.label}</span>
        {meta.detail && (
          <span className="truncate font-mono text-[11.5px] text-subtle">{meta.detail}</span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {entry.durationMs != null && entry.status !== "running" && (
            <span className="tnum text-[11px] text-faint">{formatDuration(entry.durationMs)}</span>
          )}
          <StatusGlyph status={entry.status} />
          <CaretRight
            size={12}
            className={cn("text-faint transition-transform duration-150", open && "rotate-90")}
          />
        </span>
      </button>

      <Collapse open={open}>
        <div className="space-y-2 border-t border-border px-2.5 py-2">
          {entry.input && Object.keys(entry.input).length > 0 && (
            <Field label="input">
              <CodeBlock code={JSON.stringify(entry.input, null, 2)} wrap />
            </Field>
          )}
          {entry.text && (
            <Field label={entry.status === "error" ? "error" : "output"}>
              <CodeBlock code={entry.text} wrap />
            </Field>
          )}
          {canOpen && (
            <Button variant="subtle" size="sm" onClick={() => onOpenFile?.(path!)}>
              <ArrowSquareOut size={13} />
              Open file
            </Button>
          )}
        </div>
      </Collapse>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10.5px] font-medium uppercase tracking-wide text-faint">{label}</div>
      {children}
    </div>
  );
}
