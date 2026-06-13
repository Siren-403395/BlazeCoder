/** Presentation formatters - pure, unit-tested, locale-stable. */

/** 512 → "512", 12_300 → "12.3k", 1_240_000 → "1.24M". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (abs >= 1_000) return `${trim(n / 1_000)}k`;
  return String(Math.round(n));
}

/** Small agent costs: "$0.0123" under a dime, "$1.20" above. */
export function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0.00";
  return `$${n.toFixed(n < 0.1 ? 4 : 2)}`;
}

/** 120 → "120ms", 1240 → "1.2s", 64200 → "1m 4s". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${trim(s)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

/** Clamped integer percentage, used by the context gauge. */
export function percent(used: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((used / total) * 100)));
}

/** "/src/components/Button.tsx" → "Button.tsx". */
export function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** "/src/components/Button.tsx" → "/src/components". */
export function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : "/";
}

function trim(n: number): string {
  // One decimal, but drop a trailing ".0".
  return n.toFixed(1).replace(/\.0$/, "");
}
