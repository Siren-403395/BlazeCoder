import type { ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";

export interface Segment<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
}

/** Tab-like switch with a sliding active indicator (shows which surface is live). */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  layoutId = "segmented-active",
}: {
  value: T;
  options: Segment<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  layoutId?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5 rounded-control bg-surface-2 p-0.5"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-xs font-medium",
              "transition-colors duration-150",
              active ? "text-text" : "text-muted hover:text-text",
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-[6px] bg-surface shadow-soft"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {opt.icon}
              {opt.label}
              {opt.badge}
            </span>
          </button>
        );
      })}
    </div>
  );
}
