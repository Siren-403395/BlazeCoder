import { CircleNotch } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

/** Inline progress indicator for in-flight work. Spins only when motion is allowed. */
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <CircleNotch
      size={size}
      weight="bold"
      className={cn("motion-safe:animate-spin text-accent-text", className)}
      aria-hidden
    />
  );
}
