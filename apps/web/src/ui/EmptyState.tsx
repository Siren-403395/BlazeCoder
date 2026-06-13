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
        "flex h-full flex-col items-center justify-center gap-3 px-8 py-12 text-center",
        className,
      )}
    >
      {icon && <div className="text-text-faint">{icon}</div>}
      <div className="space-y-1">
        <p className="text-sm font-medium text-muted">{title}</p>
        {hint && <p className="mx-auto max-w-[42ch] text-xs leading-relaxed text-subtle">{hint}</p>}
      </div>
      {children}
    </div>
  );
}
