#!/usr/bin/env node
/**
 * `ca` entry point. Parses a minimal argv, loads config, builds the in-process
 * runtime, and renders the Ink TUI. Headless (--print) mode lands in Phase 4.
 */

import { resolve } from "node:path";
import { render } from "ink";
import { App } from "./tui/App";
import { loadConfig } from "./config";
import { buildRuntime } from "./runtime";

const VERSION = "0.1.0";
const EFFORTS = ["low", "medium", "high", "ultra"];

interface Args {
  cwd?: string;
  effort?: string;
  help: boolean;
  version: boolean;
  continue: boolean;
  /** A session id to resume, or `true` for "list sessions and pick". */
  resume?: string | true;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { help: false, version: false, continue: false };
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
    }
  }
  return args;
}

const USAGE = `coding-agent (ca) — a command-line coding agent

Usage: ca [options]

Options:
  --cwd <dir>        Working directory the agent edits (default: current dir)
  --effort <level>   Reasoning effort: ${EFFORTS.join(" | ")} (default: high)
  -c, --continue     Resume the most recent session
  --resume [id]      Resume a session by id (omit id to list recent sessions)
  -v, --version      Print version
  -h, --help         Print this help

Inside the session: type to chat; /help for commands; Esc interrupts; Ctrl+C quits.`;

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
  const effort = args.effort && EFFORTS.includes(args.effort) ? args.effort : "high";
  const config = loadConfig(cwd);
  const runtime = buildRuntime(config, cwd);

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
    process.stderr.write("Warning: no DEEPSEEK_API_KEY found; running with the offline stub model.\n");
  }

  render(<App runtime={runtime} effort={effort} initialSession={initialSession} />);
}

void main();
