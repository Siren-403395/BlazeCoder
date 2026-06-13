import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** A full-height surface region: header + scrollable body, composed by layout. */
export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn("flex min-h-0 min-w-0 flex-col bg-surface", className)}>{children}</section>
  );
}

export function PanelHeader({
  className,
  children,
  actions,
}: {
  className?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header
      className={cn(
        "relative z-10 flex h-11 shrink-0 items-center justify-between gap-2 chrome-top px-3.5",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-text">{children}</div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </header>
  );
}

export function PanelBody({
  className,
  children,
  scroll = false,
}: {
  className?: string;
  children: ReactNode;
  scroll?: boolean;
}) {
  return (
    <div className={cn("min-h-0 flex-1", scroll && "overflow-auto", className)}>{children}</div>
  );
}
