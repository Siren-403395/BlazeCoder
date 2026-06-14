import { BrainCircuit, FolderGit2, Layers } from "lucide-react";
import { EFFORTS } from "../../shared/ipc";
import type { Effort } from "../../shared/ipc";
import type { BudgetState, RunStatus } from "../app/types";
import { formatTokens, shortPath } from "../app/format";

export function TopBar({
  cwd,
  model,
  permissionMode,
  effort,
  onEffort,
  budget,
  status,
  onCompact,
  canCompact,
}: {
  cwd: string;
  model?: string;
  permissionMode: string;
  effort: Effort;
  onEffort: (e: Effort) => void;
  budget: BudgetState | null;
  status: RunStatus;
  onCompact: () => void;
  canCompact: boolean;
}) {
  const pct = budget && budget.totalTokens > 0 ? Math.min(100, Math.round((budget.usedTokens / budget.totalTokens) * 100)) : 0;
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__logo" aria-hidden>
          ✶
        </span>
        <span className="topbar__name">zephyrcode</span>
      </div>

      <div className="topbar__project" title={cwd}>
        <FolderGit2 size={14} strokeWidth={1.75} />
        <span>{shortPath(cwd)}</span>
        {model ? <span className="topbar__model">{model}</span> : null}
        <span className={`tag tag--${permissionMode}`}>{permissionMode}</span>
      </div>

      <div className="topbar__right">
        {budget ? (
          <button className="gauge" onClick={onCompact} disabled={!canCompact} title="Compact the conversation context">
            <Layers size={13} strokeWidth={1.75} />
            <span className="gauge__track">
              <span className="gauge__fill" style={{ width: `${pct}%` }} />
            </span>
            <span className="gauge__label">{formatTokens(budget.usedTokens)}</span>
          </button>
        ) : null}

        <label className="effort">
          <BrainCircuit size={14} strokeWidth={1.75} />
          <select value={effort} onChange={(e) => onEffort(e.target.value as Effort)} disabled={status !== "idle"}>
            {EFFORTS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}
