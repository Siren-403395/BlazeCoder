/**
 * The Shift+Tab permission-mode cycle — a small DATA table so adding a mode (e.g. Plan) is one
 * row, not a new branch. Each UI mode maps a product-level label to an engine PermissionMode and
 * an optional bottom-left indicator (null = baseline, render nothing). The array order IS the
 * cycle order; App reads/advances it and applies `permission` to the runtime.
 */

import type { PermissionMode } from "@zephyrcode/core";

export interface UiMode {
  /** Stable id tracked in TUI state. */
  id: string;
  /** Engine permission mode this UI mode activates. */
  permission: PermissionMode;
  /** Bottom-left indicator shown while active; null = baseline (clean, no indicator). */
  indicator: { glyph: string; label: string } | null;
}

/**
 * Enabled modes, in cycle order. `normal` preserves the prior default (auto-accept edits, ask
 * before commands); `auto` is full autonomy with the safety floor intact. Add a `plan` row here
 * to extend the cycle once plan-mode's exit flow is wired.
 */
export const UI_MODES: UiMode[] = [
  { id: "normal", permission: "acceptEdits", indicator: null },
  { id: "auto", permission: "auto", indicator: { glyph: "▶▶", label: "auto mode on" } },
  // { id: "plan", permission: "plan", indicator: { glyph: "◷", label: "plan mode on" } },
];

/** Resolve a UI mode by id (falls back to the first/baseline entry). */
export function modeById(id: string): UiMode {
  return UI_MODES.find((m) => m.id === id) ?? UI_MODES[0]!;
}

/** The cycle entry matching an engine permission mode, for startup labeling (falls back to baseline). */
export function modeForPermission(p: PermissionMode): UiMode {
  return UI_MODES.find((m) => m.permission === p) ?? UI_MODES[0]!;
}

/** The next mode id in the cycle (wraps around). */
export function nextModeId(id: string): string {
  const i = UI_MODES.findIndex((m) => m.id === id);
  return UI_MODES[(i + 1) % UI_MODES.length]!.id;
}
