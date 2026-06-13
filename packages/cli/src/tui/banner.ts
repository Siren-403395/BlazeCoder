/**
 * The welcome banner shown on an empty session. The logo is a hand-set 5-row
 * block wordmark (no figlet dependency); keep every row the same display width
 * so it stays aligned. A compact fallback is used on narrow terminals.
 */

export const LOGO: string[] = [
  "█████ █████ ████  █   █ █   █ ████ ",
  "   ██ █     █   █ █   █  █ █  █   █",
  "  ██  ████  ████  █████   █   ████ ",
  " ██   █     █     █   █   █   █  █ ",
  "█████ █████ █     █   █   █   █   █",
];

/** Display width of the logo (all rows are padded to this). */
export const LOGO_WIDTH = 35;

export const TAGLINE = "zephyrcode · a command-line coding agent";
