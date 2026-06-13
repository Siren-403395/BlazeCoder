import type { Budget } from "@/lib/agentState";
import { formatTokens, percent } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/ui";

/**
 * Context window usage gauge. Two shapes:
 * - compact: a single inline strip for the status bar.
 * - full: a labelled block with a full-width bar.
 *
 * Renders nothing when there is no budget to report.
 */
export function ContextGauge({ budget, compact }: { budget?: Budget; compact?: boolean }) {
  if (!budget || budget.totalTokens <= 0) return null;

  const { usedTokens: used, totalTokens: total } = budget;
  const pct = percent(used, total);
  const high = pct > 80;

  if (compact) {
    return (
      <Tooltip label={`${formatTokens(used)} / ${formatTokens(total)} tokens`}>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-subtle">context</span>
          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-3">
            <span
              className={cn(
                "block h-full rounded-full transition-[width] duration-300",
                high ? "bg-warn" : "bg-accent",
              )}
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className="font-mono tnum">{pct}%</span>
        </span>
      </Tooltip>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted">Context</span>
        <span className="font-mono tnum text-subtle">
          {formatTokens(used)} / {formatTokens(total)}
        </span>
      </div>
      <span className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
        <span
          className={cn(
            "block h-full rounded-full transition-[width] duration-300",
            high ? "bg-warn" : "bg-accent",
          )}
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  );
}
