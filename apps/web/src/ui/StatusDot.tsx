import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import type { Tone } from "./Badge";

const COLORS: Record<Tone, string> = {
  neutral: "bg-text-faint",
  accent: "bg-accent",
  success: "bg-success",
  danger: "bg-danger",
  info: "bg-info",
  warn: "bg-warn",
};

/** A small state dot. `pulse` animates it; the pulse is dropped when the user
 *  prefers reduced motion (in addition to the global CSS safety net). */
export function StatusDot({
  tone = "neutral",
  pulse = false,
  className,
}: {
  tone?: Tone;
  pulse?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)}>
      {pulse && !reduce && (
        <span
          className={cn("absolute inset-0 rounded-full opacity-60", COLORS[tone])}
          style={{ animation: "ca-pulse 1.6s ease-in-out infinite" }}
          aria-hidden
        />
      )}
      <span className={cn("relative size-2 rounded-full", COLORS[tone])} />
    </span>
  );
}
