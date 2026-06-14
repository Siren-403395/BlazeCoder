/**
 * `ca` entry point. Parses argv, loads config, builds the in-process runtime, and
 * either renders the Ink TUI or runs one prompt headlessly (--print). The bundled
 * dist/zephyrcode.js gets its node shebang from the tsup banner.
 */

import { resolve } from "node:path";
import { render } from "ink";
import { App } from "./tui/App";
import { Onboarding } from "./tui/Onboarding";
import { loadConfig } from "./config";
import { runSetup, shouldRunOnboardingGate } from "./onboarding";
import { PROVIDERS } from "./providers";
import { migrateLegacySessions } from "./projects";
import { buildRuntime } from "./runtime";
import { runHeadless, type OutputFormat } from "./headless";
import { isEffort, type Effort } from "@coding-agent/core";

/** Wipe the screen + scrollback so the chat starts clean after the onboarding panel. */
const CLEAR_SCREEN = "\x1b[2J\x1b[3J\x1b[H";

const VERSION = "0.1.0";
const EFFORTS = ["low", "high", "ultra"];

interface Args {
  cwd?: string;
  effort?: string;
  help: boolean;
  version: boolean;
  continue: boolean;
  /** A session id to resume, or `true` for "list sessions and pick". */
  resume?: string | true;
  /** Headless: the prompt to run non-interactively. */
  print?: string;
  format?: OutputFormat;
  yolo: boolean;
  /** Re-run onboarding (provider/model/key) and exit. */
  setup: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { help: false, version: false, continue: false, yolo: false, setup: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--version" || a === "-v") args.version = true;
    else if (a === "--cwd") args.cwd = argv[++i];
    else if (a.startsWith("--cwd=")) args.cwd = a.slice(6);
    else if (a === "--effort") args.effort = argv[++i];
    else if (a.startsWith("--effort=")) args.effort = a.slice(9);
    else if (a === "--continue" || a === "-c") args.continue = true;
    else if (a.startsWith("--resume=")) args.resume = a.slice(9);
    else if (a === "--resume") {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) args.resume = argv[++i];
      else args.resume = true;
    } else if (a === "--print" || a === "-p") args.print = argv[++i];
    else if (a.startsWith("--print=")) args.print = a.slice(8);
    else if (a === "--output-format") args.format = argv[++i] as OutputFormat;
    else if (a.startsWith("--output-format=")) args.format = a.slice(16) as OutputFormat;
    else if (a === "--yolo" || a === "--dangerously-allow-all") args.yolo = true;
    else if (a === "--setup" || a === "--login") args.setup = true;
  }
  return args;
}

const USAGE = `zephyrcode — a command-line coding agent

Usage: zephyrcode [options]

Options:
  --cwd <dir>        Working directory the agent edits (default: current dir)
  --effort <level>   Reasoning effort: ${EFFORTS.join(" | ")} (default: high)
  -c, --continue     Resume the most recent session
  --resume [id]      Resume a session by id (omit id to list recent sessions)
  -p, --print <text> Run one prompt headlessly (no TUI) and print the result
  --output-format    Headless output: text | json | stream-json (default text)
  --yolo             Headless: auto-approve tool calls (DANGEROUS; for trusted CI)
  --setup            Connect or change your model provider + API key, then exit
  --update           Update zephyrcode to the latest build (handled by the launcher)
  -v, --version      Print version
  -h, --help         Print this help

Inside the session: type to chat; /help for commands; Esc interrupts; Ctrl+C quits.`;

/**
 * Render the first-run onboarding screen and resolve once the user finishes (true if
 * a key was saved, false if skipped). A Ctrl+C exit quits the process outright rather
 * than dropping into the chat. We fully await teardown so App's stdin handler takes
 * over cleanly afterward.
 */
async function runTuiOnboarding(home: string): Promise<boolean> {
  let saved = false;
  let finished = false;
  const app = render(
    <Onboarding
      providers={PROVIDERS}
      home={home}
      onDone={(ok) => {
        saved = ok;
        finished = true;
        app.unmount();
      }}
    />,
  );
  await app.waitUntilExit();
  if (!finished) process.exit(130); // Ctrl+C during setup → quit
  return saved;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const cwd = args.cwd ? resolve(args.cwd) : process.cwd();
  const effort: Effort = args.effort && isEffort(args.effort) ? args.effort : "high";
  const format: OutputFormat = args.format && ["text", "json", "stream-json"].includes(args.format) ? args.format : "text";
  let config = loadConfig(cwd);

  // Explicit reconfigure: `zephyrcode --setup`. Readline flow (works piped), then exit.
  if (args.setup) {
    await runSetup(config.home);
    return;
  }

  // First-run gate: no key yet, interactive terminal, not a headless run → guide the
  // user through provider/model/key in the TUI, then re-read the freshly saved config.
  // (--continue/--resume still work: onboarding precedes session resolution below, and
  // the user can Esc-skip to the offline stub if they only want to read a session.)
  if (shouldRunOnboardingGate(config, { headless: args.print !== undefined, isTTY: Boolean(process.stdin.isTTY) })) {
    const saved = await runTuiOnboarding(config.home);
    if (saved) process.stdout.write(CLEAR_SCREEN);
    config = loadConfig(cwd);
  }

  await migrateLegacySessions(config.home); // relocate any pre-isolation global sessions
  const runtime = buildRuntime(config, cwd, { permissionMode: args.yolo ? "bypassPermissions" : undefined });

  // Resolve a session to resume, if requested.
  let initialSession;
  if (args.resume === true) {
    const sessions = await runtime.listSessions();
    if (sessions.length === 0) process.stdout.write("No saved sessions.\n");
    else {
      process.stdout.write("Recent sessions (resume with --resume <id>):\n");
      for (const s of sessions.slice(0, 20)) {
        process.stdout.write(`  ${s.id}  ${new Date(s.updatedAt).toISOString()}  ${s.turns} turns  ${s.title}\n`);
      }
    }
    return;
  }
  if (typeof args.resume === "string") {
    initialSession = await runtime.getSession(args.resume);
    if (!initialSession) process.stderr.write(`Session not found: ${args.resume}; starting fresh.\n`);
  } else if (args.continue) {
    const [latest] = await runtime.listSessions();
    if (latest) initialSession = await runtime.getSession(latest.id);
    else process.stderr.write("No session to continue; starting fresh.\n");
  }

  if (!config.apiKey && !config.fakeModel) {
    process.stderr.write("Warning: no API key configured; running with the offline stub model. Run `zephyrcode --setup` to connect one.\n");
  }

  // Headless: run one prompt, print, and exit with the run's status.
  if (args.print !== undefined) {
    if (!args.print.trim()) {
      process.stderr.write("Empty --print prompt.\n");
      process.exit(2);
    }
    const code = await runHeadless(runtime, { prompt: args.print, effort, format, sessionId: initialSession?.id });
    process.exit(code);
  }

  render(<App runtime={runtime} effort={effort} initialSession={initialSession} />);
}

void main();
