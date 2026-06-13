import { useEffect, useRef, useState } from "react";
import { CaretDown, ClockCounterClockwise, Plus } from "@phosphor-icons/react";
import { Spinner } from "@/ui";
import { cn } from "@/lib/cn";
import { listSessions } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import type { SessionSummary } from "@coding-agent/shared";

/**
 * History menu: lists persisted sessions (fetched on open) so a run can be
 * resumed, plus a "New session" action. Presentation owns its open state; the
 * resume/reset decisions are delegated up via callbacks.
 */
export function SessionMenu({
  currentId,
  onSelect,
  onNew,
}: {
  currentId?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setSessions(null); // drop any stale list so reopening shows a spinner, then fresh data
    setLoading(true);
    listSessions()
      .then((s) => alive && setSessions(s))
      .catch(() => alive && setSessions([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const now = Date.now();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-7 items-center gap-1.5 rounded-control border border-border px-2 text-[12px] text-muted transition-colors hover:border-border-strong hover:text-text"
      >
        <ClockCounterClockwise size={14} />
        History
        <CaretDown size={12} className={cn("transition-transform duration-150", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 z-40 mt-1.5 w-72 overflow-hidden rounded-card border border-border bg-bg-elevated shadow-float"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onNew();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-[13px] font-medium text-text hover:bg-surface-2"
          >
            <Plus size={14} className="text-accent-text" />
            New session
          </button>

          <div className="max-h-80 overflow-auto py-1">
            {loading && (
              <div className="flex items-center gap-2 px-3 py-3 text-[12px] text-subtle">
                <Spinner size={13} />
                Loading sessions
              </div>
            )}
            {!loading && sessions && sessions.length === 0 && (
              <p className="px-3 py-3 text-[12px] text-subtle">No past sessions yet.</p>
            )}
            {!loading &&
              sessions?.map((s) => {
                const active = s.id === currentId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="menuitem"
                    aria-current={active ? "true" : undefined}
                    onClick={() => {
                      onSelect(s.id);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-surface-2",
                      active && "bg-accent-subtle",
                    )}
                  >
                    <span className={cn("truncate text-[13px]", active ? "text-accent-text" : "text-text")}>
                      {s.title}
                    </span>
                    <span className="flex items-center gap-1.5 font-mono text-[11px] tnum text-subtle">
                      {formatRelative(s.updatedAt, now)}
                      <span className="h-2.5 w-px bg-border" />
                      {s.turns} turn{s.turns === 1 ? "" : "s"}
                    </span>
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
