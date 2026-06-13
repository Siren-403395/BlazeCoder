import type { RunStats } from "@/lib/agentState";
import { formatUsd } from "@/lib/format";
import { Badge } from "@/ui";
import { ContextGauge } from "./ContextGauge";

/** A thin vertical divider used to separate ambient status items. */
function Divider() {
  return <span className="h-3 w-px bg-border" />;
}

/**
 * Slim ambient footer summarizing the current run: model, turn, context,
 * cost and file count. Intentionally quiet - it never competes for attention.
 * Run phase itself is surfaced by the header status pill, not here.
 */
export function StatusBar({ stats }: { stats: RunStats }) {
  const turns = `turn ${stats.numTurns ?? 0}${stats.maxTurns ? `/${stats.maxTurns}` : ""}`;
  const compactions = stats.compactions;
  const files = stats.fileCount;

  return (
    <div className="flex h-7 shrink-0 items-center justify-between gap-3 border-t border-border bg-surface px-3 text-[11px] font-mono tnum text-subtle">
      <div className="flex items-center gap-3">
        <span>{stats.model ?? "offline"}</span>
        <Divider />
        <span>{turns}</span>
      </div>

      <div className="flex items-center gap-3">
        {compactions > 0 && (
          <Badge tone="info" mono>
            {compactions} compaction{compactions > 1 ? "s" : ""}
          </Badge>
        )}
        <ContextGauge compact budget={stats.budget} />
        <Divider />
        <span>{formatUsd(stats.costUsd ?? 0)}</span>
        <Divider />
        <span>
          {files} file{files === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
