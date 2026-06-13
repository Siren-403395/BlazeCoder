import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Centered, composed empty state - never a bare "nothing here" string. */
export function EmptyState({
  icon,
  title,
  hint,
  className,
  children,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center gap-4 px-8 py-12 text-center",
        className,
      )}
    >
      {icon && (
        <div className="relative flex items-center justify-center">
          <span className="empty-halo pointer-events-none absolute -inset-10 rounded-full" aria-hidden />
          <span className="empty-tile relative flex size-16 items-center justify-center rounded-card text-tile-icon">
            {icon}
          </span>
        </div>
      )}
      <div className="space-y-1.5">
        <p className="text-[15px] font-medium text-text">{title}</p>
        {hint && <p className="mx-auto max-w-[42ch] text-[13px] leading-relaxed text-muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}
