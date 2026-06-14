# zephyrcode

A **command-line coding agent** for your terminal — in the spirit of Claude Code, powered by DeepSeek.

It runs in your shell, reads and edits **real files** in your working directory, and runs **real shell commands** under a permission gate — so it can work on a frontend, a backend, a script, or anything else, not a sandboxed toy. One model-driven loop (**gather context → act → verify**, repeated until the model stops calling tools) drives a small, sharp set of tools.

```
prompt → [model] → tool calls (Read / Edit / Bash / Grep / …)
       → tool results fed back → [model] → … → done
```

The design is grounded in how Claude Code / Codex / OpenCode actually work — see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

> Status: early but real. 332 tests green across unit / integration / e2e. License: MIT.

---

## Quickstart

```bash
git clone <your-repo-url> zephyrcode && cd zephyrcode
./install.sh
```

`install.sh` builds the agent, writes your config to `~/.zephyrcode/.env`, drops a `zephyrcode` launcher in `~/.local/bin`, and adds that to your `PATH`. It prompts once for a **DeepSeek API key** (or set `DEEPSEEK_API_KEY` in your environment first to skip the prompt; leave it blank to use the offline stub model). Then, from any directory:

```bash
zephyrcode             # start the interactive TUI in the current directory
zephyrcode --help      # all options
zephyrcode --update    # git pull + rebuild to the latest
```

**Requirements:** Node.js ≥ 20 and pnpm (the installer enables it via `corepack` if missing).

> The default model is `deepseek-v4-pro`. If your DeepSeek key doesn't have access to it, set `DEEPSEEK_MODEL` to one that it does (e.g. `deepseek-chat` or `deepseek-reasoner`) in `~/.zephyrcode/.env`.
>
> The launcher remembers where you cloned the repo. If you move or rename the clone, just re-run `./install.sh`.

### Try it without an API key

```bash
AGENT_FAKE_MODEL=1 zephyrcode          # offline stub model — boots the whole TUI, no key needed
```

---

## Usage

```
zephyrcode [options]
  --cwd <dir>          Working directory the agent edits (default: current dir)
  --effort <level>     Reasoning effort: low | high | ultra (default: high)
  -c, --continue       Resume the most recent session
  --resume [id]        Resume a session by id (omit id to list recent sessions)
  -p, --print <text>   Run one prompt headlessly (no TUI) and print the result
  --output-format <f>  Headless output: text | json | stream-json (default: text)
  --yolo               Headless: auto-approve tool calls (DANGEROUS; for trusted CI)
  --update             Update zephyrcode to the latest build (handled by the launcher)
  -v, --version        Print version
  -h, --help           Print help
```

### Headless mode (scripting & CI)

```bash
zephyrcode -p "summarize what this repo does"                      # prose → stdout
zephyrcode -p "add a health-check endpoint" --output-format json   # one final JSON result
zephyrcode -p "rename Foo to Bar everywhere" --yolo                # auto-approve tools (trusted only)
```

`--output-format`: `text` (prose to stdout, tool activity to stderr), `json` (one final result object), or `stream-json` (one event per line).

### In the session

Type to chat. Slash commands:

| Command | What it does |
|---------|--------------|
| `/resume` | Pick a previous conversation to resume |
| `/effort <low\|high\|ultra>` | Set reasoning depth: `low` (thinking off) · `high` · `ultra` (max) |
| `/skill` | Pick and run a project skill |
| `/output-style [name]` | Switch the output style (applies next turn; `default` reverts) |
| `/usage` | Token usage and session cost |
| `/context` | How full the context window is |
| `/clear` (`/reset`) | Start a fresh session; the old one stays on disk (`/resume` to reopen) |
| `/help` | List commands and keys |
| `/exit` (`/quit`) | Quit |

Keys: **`@`** to reference a file (Tab-completes) · **`/`** for the command palette · **Tab** to accept a completion · **↑/↓** for completions or history · **Enter** to send (while a turn is running, Enter *queues* a steering message instead) · **Esc** interrupts a run · **Ctrl+C** quits. Say **"ultrathink"** (or "think harder / step by step") in a prompt to push that single turn to max effort.

When a tool needs approval: **`y`** allow once · **`a`** allow + remember for this project (local, gitignored) · **`A`** allow + remember as a committable project rule · **`n`** deny.

---

## Configuration

Config is read from, lowest priority first: `~/.zephyrcode/.env`  <  `<cwd>/.env`  <  the real environment. Only `DEEPSEEK_API_KEY` is required. Copy [`.env.example`](.env.example) for the full annotated list.

| Variable | Default | Controls |
|----------|---------|----------|
| `DEEPSEEK_API_KEY` | — | Provider API key. Empty → offline stub model. |
| `DEEPSEEK_MODEL` | `deepseek-v4-pro` | Model name (set to any model your key can call). |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | API endpoint (any OpenAI-compatible host). |
| `AGENT_MAX_TURNS` | `24` | Max tool-use turns before the loop halts. |
| `AGENT_MAX_BUDGET_USD` | `1.0` | Per-run spend cap (USD). |
| `AGENT_CONTEXT_TOKENS` | `65536` | Context window — drives the budget gauge + compaction triggers. |
| `AGENT_MAX_RETRIES` | `8` | Max transient-failure retries per model call. |
| `AGENT_FAKE_MODEL` | off | `1`/`true` → offline stub gateway (no key needed). |
| `AGENT_WEB` | off | `1`/`true` → enable the `WebSearch` / `WebFetch` tools. |
| `AGENT_OUTPUT_STYLE` | — | Output style active at startup. |
| `ZEPHYRCODE_HOME` | `~/.zephyrcode` | State + global-config home. |
| `ZEPHYRCODE_DISABLE_HOOKS` | off | `1`/`true` → global kill switch for settings command hooks. |

### Where state lives

State is **per-project**, keyed by the working directory — sessions never leak across projects:

```
~/.zephyrcode/
  .env                              # global credentials (mode 600)
  settings.json                     # user-global permission rules + hooks
  skills/  agents/  output-styles/  # user-scope extensions (always loaded)
  projects/<project-key>/           # <basename>-<8-hex of sha256(cwd)>
    sessions/                       #   conversation transcripts
    memory/                         #   durable cross-session agent memory
    hooks-trusted                   #   marker: this workspace may run project-scope hooks

<your repo>/.zephyrcode/
  settings.json                     # project permission rules + hooks (committable)
  settings.local.json               # local overrides (gitignore this)
  skills/  agents/  output-styles/  # project-scope extensions (trusted workspaces only)
  tool-results/                     # spillover for oversized tool output
```

The API key (`.env`) stays global; everything project-specific travels with the repo (settings/skills/agents/styles) or lives under the per-project state dir (sessions/memory).

---

## Features

### Tools

| Tool | What it does |
|------|--------------|
| `Read` | Read a file (`cat -n`, offset/limit, binary detection). Required before editing. |
| `Write` | Create or overwrite a file (read-before-overwrite guard). |
| `Edit` | Exact-string replacement (unique match, read-before-edit, staleness-checked). |
| `Glob` | Find files by name pattern. |
| `Grep` | Search file contents (regex; honors `.gitignore`; skips binaries). |
| `Bash` | Run a shell command (timeout, process-group kill, output cap) — and verify your work. |
| `TodoWrite` | Maintain a live task list for multi-step work (rendered in the TUI). |
| `Task` | Delegate to a **sub-agent** in a fresh context window (cannot nest). |
| `memory` | Durable cross-session notes (Anthropic `memory_20250818` verbs, sandboxed to `/memories`). |
| `Skill` | Run a project skill (reusable prompt recipe), inline or as a sub-agent. |
| `WebSearch` / `WebFetch` | Web access — **off by default**; enable with `AGENT_WEB=1`. |

### Permissions & safety

Every tool call passes an ordered gate: **hooks → protected paths → deny rules → allow rules → ask rules → mode → read-only/control auto-allow → ask the human**. Behavior priority is `deny > ask > allow` regardless of which scope a rule came from.

- **Modes:** `default` (ask before mutating/running), `acceptEdits` (auto-allow edits, still ask for Bash), `plan` (read-only; propose first), `bypassPermissions` (`--yolo` — trusted CI only).
- **Rule grammar:** `Tool` or `Tool(content)` —
  - `Bash(git push:*)` — command pattern
  - `Read(src/**)`, `Edit(*.ts)` — file globs (`*`, `?`, `**`)
  - `Task(code-reviewer)` — sub-agent type
  - `mcp__myserver` — all tools from an MCP server
- A built-in **secrets deny-list** blocks reading/writing/searching credential files, regardless of mode. A **read-before-edit ledger** refuses to edit a file that wasn't read, was deleted, or changed since. The workspace boundary is realpath-canonicalized and symlink-checked.

> Today, safety for shell commands comes from the **permission layer** plus operational guards (timeout, process-group kill, output cap) — not OS-level isolation. An OS sandbox (macOS `sandbox-exec` / Linux `bwrap`) is on the roadmap behind the existing `Sandbox` port.

### Context management

The context window is treated as the scarce resource: a token-budget gauge drives **graduated, cheapest-first compaction** — spill oversized tool output to disk → clear old tool results in place → only then summarize into a typed contract — with a thrash circuit-breaker, then deterministic rehydration of durable context after a summary.

### Memory (two layers)

- **Passive auto-memory** — `/memories/MEMORY.md` (a short, high-signal index) is read every turn and injected into context, so the agent recalls prior work without spending a tool call. No-op until the index exists.
- **Model-driven `memory` tool** — the agent reads/writes durable notes in a sandboxed `/memories` store and keeps `MEMORY.md` current.

### Effort

Three reasoning levels map onto DeepSeek's native thinking modes: `low` (thinking off) · `high` (thinking on) · `ultra` (max budget). A per-turn "ultrathink" keyword escalates a single turn to max.

### Sessions, sub-agents, hooks

- **Sessions** persist as per-project transcripts; `--resume <id>` / `--continue` reopen them.
- **Sub-agents** (`Task`) run in a fresh, isolated context and return a distilled result — strong context hygiene for exploration/review. They cannot nest.
- **Hooks** are the primary extension seam: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `PreCompact`, `SessionStart`, `SessionEnd` — wired via `settings.json` and gated by workspace trust.

---

## Extending

Drop files in — no rebuild needed. User-scope (`~/.zephyrcode/…`) is always loaded; project-scope (`<repo>/.zephyrcode/…`) loads only once you **trust** the workspace.

**Skill** — `~/.zephyrcode/skills/<name>/SKILL.md` or `<repo>/.zephyrcode/skills/<name>/SKILL.md`:
```markdown
---
name: review-pr
description: Review the working changes for bugs and style
context: inline          # "inline" (body returned as-is) | "fork" (runs as a sub-agent)
allowedTools: [Read, Grep, Bash]   # fork only
---
Review `git diff` for $ARGUMENTS. Skill files live in ${SKILL_DIR}.
```

**Sub-agent** — `~/.zephyrcode/agents/<name>.md` or `<repo>/.zephyrcode/agents/<name>.md`:
```markdown
---
name: explorer
description: Read-only codebase explorer
tools: [Read, Grep, Glob]
maxTurns: 12
---
You are a focused codebase explorer. Report findings concisely; never edit files.
```

**Output style** — `~/.zephyrcode/output-styles/<name>.md` or `<repo>/.zephyrcode/output-styles/<name>.md`:
```markdown
---
name: terse
description: One-sentence answers
keepCodingInstructions: true   # true augments the base prompt; false replaces it
---
Answer in as few words as possible.
```

**Permission rules & hooks** — `settings.json` (user / project / local):
```json
{
  "permissions": {
    "defaultMode": "acceptEdits",
    "allow": ["Read(**)", "Bash(git status:*)"],
    "ask":   ["Bash(git push:*)"],
    "deny":  ["Read(.env)"]
  },
  "hooks": {
    "PostToolUse": [
      { "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "prettier --write $FILE", "timeout": 30000 }] }
    ]
  }
}
```
Command hooks run arbitrary shell, so project-scope hooks load only for a **trusted** workspace; `ZEPHYRCODE_DISABLE_HOOKS=1` is the global kill switch.

---

## Architecture

A pnpm + Turborepo monorepo, ports-and-adapters:

```
packages/
  shared/      types shared across the agent (file / event / session schema, safety primitives)
  agent-core/  the portable, unit-tested kernel — host-agnostic, depends only on injected ports:
               loop · context (compaction / memory) · tools · permissions / hooks
               · sessions · workspace (real FS + boundary + read-before-edit ledger)
               · skills / sub-agents / output-styles · effort
  cli/         the app: an Ink TUI + headless mode + the Node/OS adapters
               (DeepSeek gateway, LocalProcessSandbox) wired to agent-core in-process
docs/ARCHITECTURE.md
```

`agent-core` contains **no** TUI, HTTP, or DeepSeek imports — everything crosses the boundary through ports (`ModelGateway`, `Workspace`, `Sandbox`, `SessionStore`, `MemoryStore`, `Clock`, `Logger`), so it runs fully under unit tests with in-memory fakes, and runs **in-process** in the CLI (there is no HTTP server). Swapping the model provider is one adapter.

---

## Development

```bash
pnpm install
pnpm --filter @coding-agent/cli zephyrcode    # run the TUI via tsx (no build step)
pnpm --filter @coding-agent/cli build         # produce packages/cli/dist/zephyrcode.js

pnpm typecheck    # all packages
pnpm test         # unit + integration + e2e (332 tests)
pnpm build        # build everything
```

- **Unit** — every `agent-core` module (tools, executor, permission gates, compaction, memory sandbox, sessions, workspace boundary/gitignore/ledger, effort, output styles, auto-memory) plus the shared safety primitives and the TUI reducer.
- **Integration** — the full loop end to end with a scripted model + in-memory fakes; the headless runner over a scripted runtime.
- **E2E** — builds the shipped bundle and drives the real `node dist/zephyrcode.js` process (argv, config, exit codes, headless output) against temp dirs.

Extending the kernel: a **new tool** is a `Tool` in `agent-core/src/tools/builtin/` plus a registration; a **new guardrail** is a `PreToolUse`/`PostToolUse` hook (no loop changes); a **new model** is one `ModelGateway` adapter.

---

## Roadmap

- OS-level command sandbox (macOS `sandbox-exec` / Linux `bwrap`) behind the existing `Sandbox` port.
- MCP server/tool integration (the tool-call contract is already transport-agnostic).
- A richer layered config file beyond `.env`.

---

## Acknowledgements

Inspired by Anthropic's [Claude Code](https://www.anthropic.com/claude-code) and its published engineering on agent loops, context management, and harness design (citations in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)). Built on the [DeepSeek](https://www.deepseek.com) API. zephyrcode is an independent project and is not affiliated with or endorsed by Anthropic or DeepSeek.

## License

[MIT](LICENSE) © 2026 Zephyr Huang
