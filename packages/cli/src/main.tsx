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
}

function parseArgs(argv: string[]): Args {
  const args: Args = { help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--version" || a === "-v") args.version = true;
    else if (a === "--cwd") args.cwd = argv[++i];
    else if (a.startsWith("--cwd=")) args.cwd = a.slice(6);
    else if (a === "--effort") args.effort = argv[++i];
    else if (a.startsWith("--effort=")) args.effort = a.slice(9);
  }
  return args;
}

const USAGE = `coding-agent (ca) — a command-line coding agent

Usage: ca [options]

Options:
  --cwd <dir>        Working directory the agent edits (default: current dir)
  --effort <level>   Reasoning effort: ${EFFORTS.join(" | ")} (default: high)
  -v, --version      Print version
  -h, --help         Print this help

Inside the session: type to chat; /help for commands; Esc interrupts; Ctrl+C quits.`;

function main(): void {
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

  if (!config.apiKey && !config.fakeModel) {
    process.stderr.write("Warning: no DEEPSEEK_API_KEY found; running with the offline stub model.\n");
  }

  render(<App runtime={runtime} effort={effort} />);
}

main();
