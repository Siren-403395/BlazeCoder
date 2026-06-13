import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Lightweight CSS tooltip (hover + focus-within); no portal, fine for chrome. */
export function Tooltip({
  label,
  side = "bottom",
  children,
}: {
  label: string;
  side?: "top" | "bottom";
  children: ReactNode;
}) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-40 -translate-x-1/2 whitespace-nowrap rounded-control",
          "bg-surface-3 px-2 py-1 text-[11px] text-text opacity-0 shadow-pop",
          "transition-opacity duration-150 group-hover/tt:opacity-100 group-focus-within/tt:opacity-100",
          side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5",
        )}
      >
        {label}
      </span>
    </span>
  );
}
