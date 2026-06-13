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

/** A small state dot. `pulse` animates it (reduced-motion safe via CSS). */
export function StatusDot({
  tone = "neutral",
  pulse = false,
  className,
}: {
  tone?: Tone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)}>
      {pulse && (
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
