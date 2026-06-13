import { cn } from "@/lib/cn";

/** Shape-matching loading placeholder (see `.shimmer` in index.css). */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-control", className)} aria-hidden />;
}
