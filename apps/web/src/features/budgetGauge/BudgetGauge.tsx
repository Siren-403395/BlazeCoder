import type { Budget } from "../../lib/agentState";

export function BudgetGauge({ budget }: { budget?: Budget }) {
  if (!budget || budget.totalTokens === 0) return null;
  const pct = Math.min(100, Math.round((budget.usedTokens / budget.totalTokens) * 100));
  return (
    <div className="budget" title={`${budget.usedTokens} / ${budget.totalTokens} tokens`}>
      <div className="budget-label">
        context <strong>{pct}%</strong>
      </div>
      <div className="budget-bar">
        <div className="budget-fill" style={{ width: `${pct}%` }} data-warn={pct > 80} />
      </div>
    </div>
  );
}
