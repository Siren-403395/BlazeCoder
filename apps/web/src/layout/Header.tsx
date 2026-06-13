import { DownloadSimple, Moon, Sparkle, Sun } from "@phosphor-icons/react";
import { Badge, Button, IconButton, StatusDot } from "@/ui";
import type { Tone } from "@/ui";
import type { UiStatus } from "@/lib/agentState";
import type { ResolvedTheme } from "@/hooks/useTheme";
import { SessionMenu } from "@/features/sessions/SessionMenu";

const PHASE: Record<UiStatus, { tone: Tone; label: string; pulse?: boolean }> = {
  idle: { tone: "neutral", label: "Ready" },
  running: { tone: "accent", label: "Working", pulse: true },
  awaiting_permission: { tone: "warn", label: "Needs you", pulse: true },
  done: { tone: "success", label: "Done" },
  error: { tone: "danger", label: "Error" },
};

export function Header({
  phase,
  model,
  sessionId,
  resolvedTheme,
  onToggleTheme,
  onExport,
  canExport,
  onSelectSession,
  onNewSession,
}: {
  phase: UiStatus;
  model?: string;
  sessionId?: string;
  resolvedTheme: ResolvedTheme;
  onToggleTheme: () => void;
  onExport: () => void;
  canExport: boolean;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
}) {
  const p = PHASE[phase];
  return (
    <header className="relative z-10 flex h-[52px] shrink-0 items-center justify-between gap-3 chrome-top px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-6 items-center justify-center rounded-control bg-gradient-to-br from-accent-hover to-accent-active text-accent-fg edge-hi shadow-[0_3px_10px_-3px_var(--accent-border)]">
          <Sparkle size={14} weight="fill" />
        </span>
        <span className="text-sm font-semibold tracking-tight text-text">Coding Agent</span>
        <span className="hidden h-4 w-px rule-v sm:block" />
        <SessionMenu currentId={sessionId} onSelect={onSelectSession} onNew={onNewSession} />
        {model && (
          <Badge tone="neutral" mono className="hidden md:inline-flex">
            {model}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-surface-2 px-2 text-[11px] text-muted">
          <StatusDot tone={p.tone} pulse={p.pulse} />
          {p.label}
        </span>
        {sessionId && (
          <span className="hidden font-mono text-[11px] text-faint md:inline">{sessionId.slice(0, 8)}</span>
        )}
        <IconButton
          label={resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          onClick={onToggleTheme}
        >
          {resolvedTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </IconButton>
        <Button variant="ghost" size="sm" onClick={onExport} disabled={!canExport}>
          <DownloadSimple size={14} />
          Export
        </Button>
      </div>
    </header>
  );
}
