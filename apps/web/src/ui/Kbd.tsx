import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Kbd({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-border",
        "bg-surface-2 px-1 font-mono text-[10.5px] leading-none text-muted",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
