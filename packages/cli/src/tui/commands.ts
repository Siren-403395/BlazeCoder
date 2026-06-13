/**
 * The slash-command registry — the single source of truth for the command
 * palette (autocomplete + descriptions), the argument-hint ghost text, and the
 * executor in App. Adding a command is one row here.
 */

import { EFFORTS } from "@coding-agent/core";

export interface SlashCommand {
  name: string;
  description: string;
  /** Faint placeholder shown after `/<cmd> ` while the argument is still empty. */
  argHint?: string;
  /** Valid argument values (used for the hint and could drive arg completion). */
  argChoices?: string[];
  aliases?: string[];
}

export const COMMANDS: SlashCommand[] = [
  { name: "resume", description: "Resume a previous conversation" },
  { name: "effort", description: "Set reasoning effort for the session", argHint: "low | medium | high | ultra", argChoices: [...EFFORTS] },
  { name: "reasoning", description: "How much of the model's thinking to show", argHint: "hidden | summary | full", argChoices: ["hidden", "summary", "full"] },
  { name: "clear", description: "Start a new session with empty context; the previous one stays on disk (resume with /resume)", aliases: ["reset"] },
  { name: "help", description: "Show available commands and keys" },
  { name: "exit", description: "Quit zephyrcode", aliases: ["quit"] },
];

export interface PaletteState {
  open: boolean;
  query: string;
  matches: SlashCommand[];
}

/**
 * Palette state for the current draft: open while the user is typing a slash
 * command NAME (a leading "/", no space yet). A trailing space means the name is
 * committed and we are into arguments, so the palette closes.
 */
export function palette(draft: string): PaletteState {
  if (!draft.startsWith("/") || draft.includes(" ")) return { open: false, query: "", matches: [] };
  const query = draft.slice(1).toLowerCase();
  const matches = COMMANDS.filter(
    (c) => c.name.startsWith(query) || (c.aliases ?? []).some((a) => a.startsWith(query)),
  );
  return { open: matches.length > 0, query, matches };
}

/** Resolve a command by name or alias. */
export function findCommand(name: string): SlashCommand | undefined {
  return COMMANDS.find((c) => c.name === name || (c.aliases ?? []).includes(name));
}

/** The faint argument hint to show after `/<cmd> ` while the argument is empty. */
export function argGhost(draft: string): string | null {
  const m = /^\/(\S+)\s(.*)$/.exec(draft);
  if (!m) return null;
  const cmd = findCommand(m[1]!);
  if (!cmd?.argHint) return null;
  return m[2]!.length === 0 ? cmd.argHint : null;
}
