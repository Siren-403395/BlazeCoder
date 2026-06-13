# zephyrcode

A Claude-Code-style **command-line coding agent**. It runs in your terminal, edits
real files in your working directory, and runs real shell commands — so it can
work on frontend, backend, or anything else, not just a sandboxed preview. One
model-driven loop (gather context → act → verify) drives a small set of sharp
tools under a permission gate.

The design is grounded in how Claude Code / Codex / OpenCode actually work — see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## What makes it an *agent* (not a prompt chain)

One loop — **gather → act → verify → repeat** — until the model stops calling tools:

```
prompt → [model] → tool calls (Read / Edit / Bash / …)
       → tool results fed back → [model] → … → done
```

Built-in tools, at Claude-Code parity:

| Tool | What it does |
|------|--------------|
| `Read` | Read a file (`cat -n`, offset/limit, binary detection). Required before editing. |
| `Write` | Create or overwrite a file (read-before-overwrite guard). |
| `Edit` | Exact-string replacement (unique, read-before-edit, staleness-checked). |
| `Glob` | Find files by name pattern. |
| `Grep` | Search file contents (regex; honors `.gitignore`; skips binaries). |
| `Bash` | Run a shell command (timeout, process-group kill, output cap) — and verify your work. |
| `memory` | Durable cross-session notes. |

The loop is bounded by **our** caps (max turns, max budget) and guarded by a
permission engine, hooks, a read-before-edit ledger, a secrets deny-list, and a
canonicalized + symlink-checked workspace boundary.

## Layout (pnpm + Turborepo monorepo)

```
packages/
  shared/      types shared across the agent (file/event/session schema, safety)
  agent-core/  the portable, unit-tested kernel:
               loop · context (compaction/memory) · tools · permissions/hooks
               · sessions · workspace (real FS + boundary + ledger) · effort
               — depends only on injected ports
  cli/         the app: an Ink TUI + headless mode + the Node/OS adapters
               (DeepSeek gateway, LocalProcessSandbox) wired to agent-core
               in-process. There is no HTTP server.
docs/ARCHITECTURE.md
```

`agent-core` contains **no** TUI, HTTP, or DeepSeek imports — everything crosses
the boundary through ports (`ModelGateway`, `Workspace`, `Sandbox`,
`SessionStore`, `MemoryStore`, `Clock`, `Logger`), so it runs fully under unit
tests with in-memory fakes.

## Install

One command — builds the agent, configures your API key, and puts `zephyrcode`
on your PATH (like Claude Code's installer):

```bash
git clone <this-repo> && cd <this-repo>
./install.sh
```

It prompts for your DeepSeek API key (or set `DEEPSEEK_API_KEY` in the env first
to skip the prompt; leave it blank to use the offline stub model), writes it to
`~/.zephyrcode/.env`, drops a launcher in `~/.local/bin`, and adds that to your
PATH. Then, from any directory:

```bash
zephyrcode            # start the interactive TUI in the current directory
zephyrcode --update   # rebuild to the latest
zephyrcode --help     # all options
```

Requires Node.js >= 20 and pnpm.

### Usage

```
zephyrcode [options]
  --cwd <dir>          working directory the agent edits (default: current dir)
  --effort <level>     reasoning effort: low | medium | high | ultra (default high)
  -c, --continue       resume the most recent session
  --resume [id]        resume a session by id (omit id to list recent sessions)
  -p, --print <text>   run one prompt headlessly and print the result (text|json|stream-json)
  --output-format      headless output format (default text)
  --yolo               headless: auto-approve tool calls (DANGEROUS; for trusted CI)
  --update             update zephyrcode to the latest build
```

In the session: type to chat; `/effort <level>`, `/reasoning <hidden|summary|full>`,
`/clear`, `/help`, `/exit`. Say "ultrathink" in a prompt to push that turn to max
effort. `Esc` interrupts a run; `Ctrl+C` quits. State lives under `~/.zephyrcode`.

### From source (development)

```bash
pnpm install
pnpm --filter @coding-agent/cli zephyrcode   # run the TUI via tsx (no build)
pnpm --filter @coding-agent/cli build         # produce packages/cli/dist/zephyrcode.js
```

## Verify

```bash
pnpm typecheck   # all packages
pnpm test        # unit + integration + e2e
```

- **Unit** — every `agent-core` module (tools, executor, permission gates,
  compaction, memory sandbox, sessions, workspace boundary/gitignore/ledger,
  effort) plus the shared safety primitives and the TUI reducer.
- **Integration** — the full loop end to end with a scripted model + fakes;
  the headless runner over a scripted runtime.
- **E2E** — builds the shipped bundle and drives the real `node dist/ca.js`
  process (argv, config, exit codes, headless output) against temp dirs.

## Extending

- **New tool** → add a `Tool` in `agent-core/src/tools/builtin/` and register it.
- **New guardrail** → register a `PreToolUse` / `PostToolUse` hook (no loop changes).
- **New model** → implement the `ModelGateway` port (one adapter).
- **New sub-agent** → a row in the agent registry (data, not code).

Known follow-ups (not yet built): an OS-level command sandbox (macOS
`sandbox-exec` / Linux `bwrap`) wrapping `LocalProcessSandbox`; a `Tool(specifier)`
permission rule grammar with persisted "always allow"; markdown slash-command /
skill files; a model-callable `task` sub-agent tool.
