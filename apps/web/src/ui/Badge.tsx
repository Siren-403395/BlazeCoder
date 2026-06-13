import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type Tone = "neutral" | "accent" | "success" | "danger" | "info" | "warn";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  accent: "bg-accent-subtle text-accent-text",
  success: "bg-success-subtle text-success-text",
  danger: "bg-danger-subtle text-danger-text",
  info: "bg-info-subtle text-info-text",
  warn: "bg-warn-subtle text-warn",
};

export function Badge({
  tone = "neutral",
  mono = false,
  className,
  children,
}: {
  tone?: Tone;
  mono?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-[11px] font-medium leading-none",
        mono && "font-mono",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
