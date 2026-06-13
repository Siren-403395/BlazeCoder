import type { DiffRow } from "@/lib/diff";
import { diffLines, diffStats } from "@/lib/diff";
import { Badge } from "@/ui";
import { cn } from "@/lib/cn";

const SIGN: Record<DiffRow["type"], string> = {
  add: "+",
  del: "-",
  same: " ",
};

const ROW_BG: Record<DiffRow["type"], string> = {
  add: "bg-success-subtle",
  del: "bg-danger-subtle",
  same: "",
};

/** Side-by-line-number unified diff for a single file. */
export function DiffView({ prev, next }: { prev: string; next: string }) {
  const rows = diffLines(prev, next);
  const { added, removed } = diffStats(rows);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="group"
        aria-label={`${added} lines added, ${removed} lines removed`}
        className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3"
      >
        <Badge tone="success" mono>
          +{added}
        </Badge>
        <Badge tone="danger" mono>
          -{removed}
        </Badge>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-bg font-mono text-[12px] leading-relaxed">
        {rows.map((row, i) => (
          <div
            key={i}
            className={cn("flex whitespace-pre", ROW_BG[row.type])}
          >
            <span className="w-9 shrink-0 select-none pr-2 text-right text-faint tnum">
              {row.before ?? ""}
            </span>
            <span className="w-9 shrink-0 select-none pr-2 text-right text-faint tnum">
              {row.after ?? ""}
            </span>
            <span className="w-4 shrink-0 select-none text-center text-faint">
              {SIGN[row.type]}
            </span>
            <span className="flex-1 pr-3">{row.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
