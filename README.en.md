<!-- language switch / 语言切换 -->
<p align="center">
  <a href="README.md">简体中文</a>
  &nbsp;·&nbsp;
  <a href="README.en.md"><b>English</b></a>
</p>

<div align="center">

<h1>✶ zephyrcode</h1>

<p><b>An AI coding agent that lives in your terminal</b></p>

<p>Reads and edits real files, runs real shell commands, powered by DeepSeek.<br>
Not a sandboxed toy. Frontend, backend, scripts, anything.</p>

<p>
  <img alt="license" src="https://img.shields.io/badge/license-MIT-e8a64d?style=flat-square&labelColor=2b2b2b">
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A5%2020-e8a64d?style=flat-square&labelColor=2b2b2b">
  <img alt="tests" src="https://img.shields.io/badge/tests-546%20passing-e8a64d?style=flat-square&labelColor=2b2b2b">
  <img alt="context" src="https://img.shields.io/badge/context-1M%20tokens-e8a64d?style=flat-square&labelColor=2b2b2b">
  <img alt="model" src="https://img.shields.io/badge/model-deepseek--v4--pro-e8a64d?style=flat-square&labelColor=2b2b2b">
</p>

</div>

<!-- TODO: a terminal demo GIF (asciinema / vhs) belongs here. It sells the tool better than any prose. -->

```bash
git clone https://github.com/zephyr4123/zephyrcode.git && cd zephyrcode && ./install.sh
```

<div align="center"><sub>One command: build → write config → put <code>zephyrcode</code> on your PATH. Then run <code>zephyrcode</code> in any directory.</sub></div>

<br>

<table>
<tr>
<td valign="top" width="50%">

**What it is**

- A **model-driven loop**: gather context → act → verify, until the model stops calling tools
- Edits files and runs shell **in your working directory**, behind a **permission gate**
- Ports-and-adapters: the `agent-core` kernel is host-agnostic and runs **in-process** (no HTTP server)
- **Model-adapter architecture**: DeepSeek V4 Pro today; adding Gemini / Claude is one provider file

</td>
<td valign="top" width="50%">

**At a glance**

- **1M-token** context, output unleashed to the model max **384K**, no small cap
- Built-in Read / Write / Edit / Glob / Grep / Bash / TodoWrite / memory + `Task` sub-agents + `Skill`
- Skills, sub-agents, output styles, command hooks all **drop a file, done**
- Passive memory, session resume, per-project isolation, tunable thinking depth

</td>
</tr>
</table>

```
prompt → [model] → tool calls (Read / Edit / Bash …) → results fed back → [model] → … → done
```

---

## Quickstart

**Requirements**

- Node.js **≥ 20**
- pnpm (the installer enables it via `corepack`, or prompts you to install it)
- A DeepSeek API key ([get one here](https://platform.deepseek.com); leave blank for the offline stub model)

**Install and run**

```bash
git clone https://github.com/zephyr4123/zephyrcode.git zephyrcode
cd zephyrcode
./install.sh           # build + drop a launcher in ~/.local/bin + guide you to connect a model

zephyrcode             # start the interactive TUI in the current directory
zephyrcode --gui       # launch the desktop GUI (Electron) — same agent as the TUI
zephyrcode --setup     # connect / switch model + key anytime
zephyrcode --help      # all options
zephyrcode --update    # git pull + rebuild to the latest
```

> **Two front-ends, one agent.** Use `zephyrcode` in the terminal, or `zephyrcode --gui` for a desktop window (it builds itself once on first launch). Both share the same `~/.zephyrcode/config.json` and the same agent kernel — connect a model once, use it from either.

**First run guides you through connecting a model**

The installer (or your first `zephyrcode` launch) opens a guided setup: **pick a model → paste your API key** (input is masked, never echoed). The key is written to `~/.zephyrcode/config.json` (mode 600). **No more hand-editing a `.env`.**

**Try it with no API key**

```bash
AGENT_FAKE_MODEL=1 zephyrcode    # offline stub model, the whole TUI works, no key needed
```

> The only model today is `deepseek-v4-pro`. To switch provider or change your key, run `zephyrcode --setup`.
> The launcher remembers where you cloned the repo; if you move it, re-run `./install.sh`.

---

## Features

<table>
<thead><tr><th>Capability</th><th>What you get</th></tr></thead>
<tbody>
<tr><td><b>Tools</b></td><td>Read · Write · Edit · Glob · Grep · Bash · TodoWrite · memory (built-in); <code>Task</code> sub-agents and <code>Skill</code> (model-callable); WebSearch / WebFetch (off by default, <code>AGENT_WEB=1</code>)</td></tr>
<tr><td><b>Permissions</b></td><td>4 modes + a rule grammar (<code>Bash(git push:*)</code>, <code>Read(src/**)</code>); built-in secrets deny-list; read-before-edit invariant</td></tr>
<tr><td><b>Context</b></td><td>1M-token window; budget-driven graduated compaction (spill → clear old tool output → summarize last), with a thrash breaker</td></tr>
<tr><td><b>Memory</b></td><td>Passive recall: <code>/memories/MEMORY.md</code> injected into context every turn; plus a model-driven <code>memory</code> tool</td></tr>
<tr><td><b>Thinking depth</b></td><td><code>low</code> / <code>high</code> / <code>ultra</code> map to DeepSeek's native thinking modes; say "ultrathink" to max a single turn. <b>Controls depth, never output length</b></td></tr>
<tr><td><b>Sessions</b></td><td>Per-project, persistent; <code>--resume</code> / <code>--continue</code>; state is isolated per project, never crosses over</td></tr>
<tr><td><b>Extensible</b></td><td>Skills, sub-agents, output styles, command hooks are all Markdown / JSON files. No code changes</td></tr>
</tbody>
</table>

---

## Usage

<table>
<thead><tr><th width="38%">CLI flag</th><th>What it does</th></tr></thead>
<tbody>
<tr><td><code>--cwd &lt;dir&gt;</code></td><td>Working directory the agent edits (default: current dir)</td></tr>
<tr><td><code>--effort &lt;level&gt;</code></td><td>Thinking depth: <code>low</code> | <code>high</code> | <code>ultra</code> (default high)</td></tr>
<tr><td><code>-c</code>, <code>--continue</code></td><td>Resume the most recent session</td></tr>
<tr><td><code>--resume [id]</code></td><td>Resume a session by id; omit id to list recent sessions</td></tr>
<tr><td><code>-p</code>, <code>--print &lt;text&gt;</code></td><td>Run one prompt headlessly and print the result (scripts / CI)</td></tr>
<tr><td><code>--output-format &lt;fmt&gt;</code></td><td>Headless output: <code>text</code> | <code>json</code> | <code>stream-json</code></td></tr>
<tr><td><code>--gui</code></td><td>Launch the desktop GUI (Electron) instead of the terminal UI</td></tr>
<tr><td><code>--yolo</code></td><td>Headless: auto-approve tool calls (dangerous, trusted CI only)</td></tr>
<tr><td><code>--update</code> · <code>-v</code> · <code>-h</code></td><td>Update to latest · version · help</td></tr>
</tbody>
</table>

<table>
<thead><tr><th width="38%">In-session slash command</th><th>What it does</th></tr></thead>
<tbody>
<tr><td><code>/resume</code></td><td>Pick and resume a past conversation</td></tr>
<tr><td><code>/effort &lt;low｜high｜ultra&gt;</code></td><td>Set thinking depth</td></tr>
<tr><td><code>/skill</code></td><td>Pick and run a project skill</td></tr>
<tr><td><code>/output-style [name]</code></td><td>Switch output style (next turn; <code>default</code> reverts)</td></tr>
<tr><td><code>/usage</code> · <code>/context</code></td><td>Token usage and cost · context window fill</td></tr>
<tr><td><code>/clear</code> · <code>/help</code> · <code>/exit</code></td><td>New session (old stays on disk) · help · quit</td></tr>
</tbody>
</table>

**Keys**: <kbd>@</kbd> reference a file · <kbd>/</kbd> command palette · <kbd>Tab</kbd> complete · <kbd>↑</kbd><kbd>↓</kbd> completion/history · <kbd>Enter</kbd> send (queues a steering message while running) · <kbd>Esc</kbd> interrupt · <kbd>Ctrl+C</kbd> quit.
When a tool needs approval: <kbd>y</kbd> allow once · <kbd>a</kbd> always (this project, gitignored) · <kbd>A</kbd> always (committable project rule) · <kbd>n</kbd> deny.

**Sample session**

```text
❯ add a debounce helper to utils.ts and write tests for it

  ✔ Read   src/utils.ts
  ✔ Write  src/utils.ts
  ✔ Write  test/utils.test.ts
  ✔ Bash   pnpm test      passing

  Added debounce() with a few edge-case tests. All green.
```

---

## Configuration

Credentials are written to `~/.zephyrcode/config.json` by onboarding (`./install.sh`, first launch, or `zephyrcode --setup`): **you never hand-edit a file, and there is no `.env`**. The variables below are optional overrides (for CI / power users); the real environment always wins.

<table>
<thead><tr><th>Variable</th><th>Default</th><th>Controls</th></tr></thead>
<tbody>
<tr><td><code>DEEPSEEK_API_KEY</code></td><td>(the saved one)</td><td>Override the stored key (CI / one-off). Nothing configured = offline stub</td></tr>
<tr><td><code>ZEPHYRCODE_MODEL</code></td><td><code>deepseek-v4-pro</code></td><td>Override the active model id</td></tr>
<tr><td><code>AGENT_CONTEXT_TOKENS</code></td><td><code>1048576</code></td><td>Context window (DeepSeek-V4-Pro ≈ 1M)</td></tr>
<tr><td><code>AGENT_MAX_OUTPUT_TOKENS</code></td><td>unset = model max 384K</td><td>Optional output ceiling; unset = unleashed, sized to fit the window</td></tr>
<tr><td><code>AGENT_MAX_TURNS</code> · <code>AGENT_MAX_BUDGET_USD</code></td><td><code>24</code> · <code>1.0</code></td><td>Per-run tool-turn / spend caps</td></tr>
<tr><td><code>AGENT_WEB</code> · <code>AGENT_FAKE_MODEL</code></td><td>off · off</td><td>Enable web tools · use the offline stub model</td></tr>
</tbody>
</table>

**Where state lives** (per-project, never crosses over):

```text
~/.zephyrcode/
  config.json                       global credentials: provider + key + model (mode 600, written by onboarding)
  settings.json                     user-level permission rules + hooks
  skills/  agents/  output-styles/  user-scope extensions (always loaded)
  projects/<project-key>/           <basename>-<8-hex of sha256(cwd)>
    sessions/                         this project's conversations
    memory/                           this project's cross-session memory

<your repo>/.zephyrcode/
  settings.json                     project permission rules + hooks (committable)
  settings.local.json               local overrides (gitignore this)
  skills/  agents/  output-styles/  project-scope extensions (trusted workspaces only)
```

The API key stays global; everything project-specific either travels with the repo or lives under the per-project state dir.

---

## Extending

Drop a file in, no rebuild needed. User scope (`~/.zephyrcode/…`) always loads; project scope (`<repo>/.zephyrcode/…`) loads once you **trust** the workspace.

<details>
<summary><b>Skill</b> &nbsp;<code>&lt;repo&gt;/.zephyrcode/skills/&lt;name&gt;/SKILL.md</code></summary>

<br>

```markdown
---
name: review-pr
description: Review the working changes for bugs and style
context: inline          # inline (body returned as-is) | fork (runs as a sub-agent)
allowedTools: [Read, Grep, Bash]   # fork only
---
Review `git diff` for $ARGUMENTS. Skill files live in ${SKILL_DIR}.
```

</details>

<details>
<summary><b>Sub-agent</b> &nbsp;<code>&lt;repo&gt;/.zephyrcode/agents/&lt;name&gt;.md</code></summary>

<br>

```markdown
---
name: explorer
description: Read-only codebase explorer
tools: [Read, Grep, Glob]
maxTurns: 12
---
You are a focused codebase explorer. Report findings concisely; never edit files.
```

</details>

<details>
<summary><b>Output style</b> &nbsp;<code>&lt;repo&gt;/.zephyrcode/output-styles/&lt;name&gt;.md</code></summary>

<br>

```markdown
---
name: terse
description: One-sentence answers
keepCodingInstructions: true   # true augments the base prompt; false replaces it
---
Answer in as few words as possible.
```

</details>

<details>
<summary><b>Permission rules & command hooks</b> &nbsp;<code>settings.json</code> (user / project / local)</summary>

<br>

```jsonc
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

</details>

---

## Architecture

A pnpm + Turborepo monorepo, ports and adapters:

```text
packages/
  shared/      types shared across the agent (file / event / session schema, safety)
  agent-core/  the portable, unit-tested kernel (@zephyrcode/core), depends only on ports:
               loop · context (compaction/memory) · tools · permissions/hooks · sessions
               · workspace (real FS + boundary + read-before-edit ledger)
               · skills / sub-agents / output-styles · effort
  host/        the Node/OS wiring (@zephyrcode/host): model gateway · local-process sandbox
               · config/settings/credentials · session+memory stores · provider registry
               · headless renderer · buildRuntime(). No UI code at all.
  cli/         terminal host: Ink TUI + headless, wires host + agent-core in-process
  desktop/     desktop host: an Electron GUI, a sibling of the TUI; also wires host in-process
docs/ARCHITECTURE.md
```

The dependency graph is a clean DAG: `shared ← core ← host ← {cli, desktop}`. Both UI hosts depend on `host` and **never on each other** — the TUI and the GUI are interchangeable sibling adapters over one runtime. The GUI renderer is an **Ink-free island** (it type-imports kernel types only, never a value import), so adding a web / vscode host later is just one more package with no change to core/cli.

`agent-core` has **no** UI, HTTP, or DeepSeek imports. Everything crosses the boundary through ports (`ModelGateway`, `Workspace`, `Sandbox`, `SessionStore`, `MemoryStore`, `Clock`, `Logger`), so it runs fully under unit tests with in-memory fakes, runs **in-process** under any host, and swapping/adding a model is one provider (with its own adapter) in `host`.

---

## Development

```bash
pnpm install
pnpm --filter @zephyrcode/cli zephyrcode    # run the TUI via tsx (no build step)
pnpm --filter @zephyrcode/cli build         # produce packages/cli/dist/zephyrcode.js
pnpm desktop                                # desktop GUI in dev mode (Vite HMR + Electron)

pnpm typecheck    # all packages
pnpm test         # unit + integration + e2e (546 tests)
pnpm build        # build everything
```

> End users run `zephyrcode --gui` (loads the built GUI); `pnpm desktop` is the dev command with hot reload.

- **Unit**: every `agent-core` module + shared safety primitives + the TUI reducer
- **Integration**: the full loop with a scripted model + in-memory fakes; the headless runner
- **E2E**: builds the real bundle and drives the real `node dist/zephyrcode.js` process (argv, config, exit codes, headless output)

New kernel capability: **a tool** is a `Tool` in `agent-core/src/tools/builtin/` plus a registration; **a guardrail** is a `PreToolUse` / `PostToolUse` hook (no loop changes); **a model provider** is one file in `cli/src/providers/` (with its own `ModelGateway` adapter) registered in the registry, and onboarding then lists it automatically.

---

## Roadmap

- More model providers: Gemini, Claude, and others (the provider registry is ready; just add a file)
- OS-level command sandbox (macOS `sandbox-exec` / Linux `bwrap`) behind the existing `Sandbox` port
- MCP server/tool integration (the tool-call contract is already transport-agnostic)

---

<div align="center">

<sub>Inspired by Anthropic's <a href="https://www.anthropic.com/claude-code">Claude Code</a>, powered by <a href="https://www.deepseek.com">DeepSeek</a>.<br>
zephyrcode is an independent project, not affiliated with or endorsed by Anthropic or DeepSeek.</sub>

<br><br>

License <a href="LICENSE"><b>MIT</b></a> © 2026 Zephyr Huang &nbsp;·&nbsp; <a href="README.md">简体中文</a>

</div>
