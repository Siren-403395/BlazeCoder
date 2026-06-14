<!-- 语言切换 / language switch -->
<p align="center">
  <a href="README.md">简体中文</a>
  &nbsp;·&nbsp;
  <a href="README.en.md"><b>English</b></a>
</p>

<div align="center">

<h1>✶ BlazeCoder</h1>

<p><b>An AI coding agent that reads and writes real files and runs real commands.</b></p>

<p>Two front-ends over one agent kernel: a terminal TUI and a desktop GUI.<br>
Powered by DeepSeek V4 Pro, with a permission gate guarding every action that lands.</p>

<p>
  <img alt="license" src="https://img.shields.io/badge/license-MIT-e8a64d?style=flat-square&labelColor=2b2b2b">
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A5%2020-e8a64d?style=flat-square&labelColor=2b2b2b">
  <img alt="tests" src="https://img.shields.io/badge/tests-548%20passing-e8a64d?style=flat-square&labelColor=2b2b2b">
  <img alt="context" src="https://img.shields.io/badge/context-1M%20tokens-e8a64d?style=flat-square&labelColor=2b2b2b">
  <img alt="output" src="https://img.shields.io/badge/output-384K-e8a64d?style=flat-square&labelColor=2b2b2b">
  <img alt="model" src="https://img.shields.io/badge/model-deepseek--v4--pro-e8a64d?style=flat-square&labelColor=2b2b2b">
</p>

<!-- TODO: a terminal demo GIF (asciinema / vhs) belongs right here, worth more than any paragraph. -->

</div>

<br>

```bash
git clone https://github.com/zephyr4123/blazecoder.git && cd blazecoder && ./install.sh
```

<div align="center"><sub>One command: build, put it on your PATH, then walk you through pasting an API key.</sub></div>

```bash
blazecoder           # launch the terminal TUI in the current directory
blazecoder --gui     # launch the desktop GUI (Electron), same agent
```

---

## 🔥 What it is

- Edits files and runs shell directly **in your working directory**, every step through a **permission gate**, not a sandbox toy.
- Powered by **DeepSeek V4 Pro** through a provider-adapter layer, so wiring up Gemini / Claude is just one more file.
- **Two front-ends, one kernel**: the terminal TUI and the desktop GUI are sibling adapters sharing the same runtime.
- A **1M-token** context window, so long sessions do not trip compaction easily.

## ⚡ Highlights

<table>
<tr>
<td valign="top" width="50%">

**Two front-ends, one kernel**

A terminal TUI (Ink) and a desktop GUI (Electron) are sibling adapters over the same agent runtime. Both depend on `@blazecoder/host`; the GUI never pulls in the TUI / Ink (a guard test watches for it).

</td>
<td valign="top" width="50%">

**1M window, output unleashed to 384K**

Runs in DeepSeek V4 Pro's full ~1,048,576-token context. Output is handed the model's hard 384K ceiling and shrunk only on physical overflow, with no artificial small cap.

</td>
</tr>
<tr>
<td valign="top" width="50%">

**Uncapped agent loop, real safety floor**

Gather, act, verify, with **no turn or budget cap by default** (opt in via env when you want one). Plus an `auto` full-autonomy mode that still holds the line on protected paths, the secrets guard, and the catastrophic-command tripwire.

</td>
<td valign="top" width="50%">

**Provider-adapter architecture: one file per model**

Every model backend lives behind one `Provider` interface (auth, URL, body, streaming, tool schema, reasoning field); onboarding, config, and runtime stay model-agnostic. Adding Gemini / Claude is one file plus one registry line. DeepSeek V4 Pro ships built in today.

</td>
</tr>
</table>

## 🖥️ Two front-ends, one kernel

<table>
<tr>
<td valign="top" width="50%">

**Terminal TUI (Ink)**

- Committed turns flow into Ink `<Static>` and into the terminal's native scrollback, with no redraw and no flicker
- Renders git-style diff blocks with line numbers when files change (green add / red remove, `+N -M` stats, long hunks folded)
- Multi-line input with soft-wrap; `@`-mention files, a `/` command palette, Tab completion, up/down history
- Thinking depth sits in the input-box top border; `Shift+Tab` cycles permission modes live (normal to auto)
- In-session pickers: resume a session, pick a skill, switch output style

</td>
<td valign="top" width="50%">

**Desktop GUI (Electron)**

- The renderer is a pure `(UiState, AgentEvent) -> UiState` reducer (a sibling of the TUI's `state.ts`), unit-tested headless
- A chat / tool timeline with streaming output, a collapsible reasoning trace, and sub-agent rows
- Inspector plus a diff viewer: tool args / results / timing, file changes rendered as a git diff with line numbers
- Permission dialog with persisted scope (deny / once / always: local, project, user)
- Sidebar listing past sessions and changed files; a top bar with project / model / mode / thinking depth and a clickable context gauge

</td>
</tr>
</table>

<sub>Both hosts depend on <code>@blazecoder/host</code> and <b>never on each other</b>. The GUI renderer never value-imports the TUI / Ink, enforced by a guard test.</sub>

## 💬 Sample session

```console
❯ add a debounce helper to src/utils.ts and cover it with a test

  ✶ Breaking this down…
  ☐ implement debounce()
  ☐ write the unit test
  ☐ run pnpm test to verify

  ✔ Read   src/utils.ts

  ⚠ Permission: Bash  pnpm test
    read / write / network: write (runs the test suite)
    [y] allow once   [a] always (local, not committed)   [A] always (commit to project rules)   [n] deny
  ❯ a

  ✔ Write  src/utils.ts
    src/utils.ts                                              +14 -0
    ┌─ 11 ┊ export function debounce<T extends (...a: any[]) => void>(
    │  12 ┊   fn: T, ms: number,
    │  13 ┊ ) { /* … +N more lines */ }
    └─ +14 -0
  ✔ Write  test/utils.test.ts                                +28 -0
  ✔ Bash   pnpm test                                         passed

  Added debounce(), covering immediate-fire, repeated-call, and cancel edges. All tests green.
```

## 🧰 Capability matrix

**Loop & context**

<table>
<thead><tr><th>Capability</th><th>What it does</th></tr></thead>
<tbody>
<tr><td><b>Uncapped loop</b></td><td>Gather context, call model, run tools, feed results back, with no turn / budget cap by default, running until the model finishes or you interrupt</td></tr>
<tr><td><b>Opt-in safety caps</b></td><td>Tool-turn (<code>AGENT_MAX_TURNS</code>) and accumulated-cost (<code>AGENT_MAX_BUDGET_USD</code>) ceilings are off by default and apply only when you set them</td></tr>
<tr><td><b>Mid-run steering</b></td><td>Type while it runs, no abort needed; the loop drains the queue after each tool turn and folds your message into the next turn</td></tr>
<tr><td><b>Sub-agent bounding</b></td><td><code>Task</code> sub-agents get a fresh context and cannot nest; an unattended sub-agent has a 50-turn fallback cap while the main loop stays uncapped</td></tr>
<tr><td><b>1M-token window</b></td><td>Runs in DeepSeek V4 Pro's full ~1,048,576-token window, so long sessions do not trip compaction easily</td></tr>
<tr><td><b>Output unleashed to 384K</b></td><td>Output is handed the model's full 384K budget, trimmed only on physical overflow, with no artificial small cap</td></tr>
<tr><td><b>Effort = thinking depth</b></td><td><code>low</code> / <code>high</code> / <code>ultra</code> map to the three native thinking modes; controls reasoning depth only, never output length</td></tr>
<tr><td><b>Graduated compaction</b></td><td>When the window gets tight, first drops regenerable old tool output in place (no LLM call), then summarizes the history head into one dense block only if still over budget</td></tr>
<tr><td><b>Thrash circuit breaker</b></td><td>Stops re-summarizing once it stops freeing meaningful space, instead of spinning forever</td></tr>
<tr><td><b>Reactive compaction</b></td><td>On a context-overflow rejection, compacts once and retries that turn automatically</td></tr>
<tr><td><b><code>/compact</code> and <code>/context</code></b></td><td>Compact on demand; get an honest per-block breakdown of window usage (system / tools / project rules / memory / history / tool output), not one blended percentage</td></tr>
<tr><td><b>Post-compaction file rehydration</b></td><td>After summarizing, re-reads recently changed files from disk and injects their latest content, clears the read ledger, and forces a re-read before the next edit</td></tr>
</tbody>
</table>

**Permissions & safety**

<table>
<thead><tr><th>Capability</th><th>What it does</th></tr></thead>
<tbody>
<tr><td><b>Ordered permission gate</b></td><td>Every tool call passes a fixed 8-step gate (hooks, protected paths, deny, allow, ask, mode decision, read-only auto-pass, human prompt), each decision carrying a machine-readable reason</td></tr>
<tr><td><b>5 permission modes</b></td><td><code>default</code> (asks before any write / command) · <code>acceptEdits</code> (auto-approves edits, still asks for commands) · <code>auto</code> (full autonomy, safety floor intact) · <code>plan</code> (read-only, denies every non-read-only tool) · <code>bypass</code> (<code>--yolo</code>, allows everything)</td></tr>
<tr><td><b>Catastrophic tripwire</b></td><td>A narrow classifier spots irreversible commands (<code>rm -rf</code> on root / home / system dirs, fork bombs, <code>dd</code> / <code>mkfs</code>, recursive chmod/chown on <code>/</code> or <code>~</code>, etc.) and forces a human confirmation even when an "always allow" rule or a hook would let them through</td></tr>
<tr><td><b>Secrets guard</b></td><td>A deterministic guard, independent of the model and the permission mode, refuses to read or write known secret / credential files (<code>.env</code>, <code>.pem</code>, <code>id_rsa</code>, <code>.ssh/</code>, <code>.aws/</code> …) and refuses to write content that looks like an API key / private key</td></tr>
<tr><td><b>Protected paths</b></td><td>VCS internals, secrets, shell rc, and tool config (<code>.git/</code>, <code>.ssh/</code>, <code>.aws/</code>, <code>.netrc</code> …) are checked before any allow rule and never auto-pass except under bypass</td></tr>
<tr><td><b>Read-before-edit</b></td><td>Read records a file's mtime + size; Edit and overwrite-Write refuse any file that was never read, or that changed on disk since reading, so they never blind-edit / overwrite outside changes</td></tr>
<tr><td><b>Rule grammar</b></td><td>Rules like <code>Bash(git push:*)</code> and <code>Read(src/**)</code> dispatch per-tool matchers; prefix / glob allow rules never match chained commands (<code>a && b</code>), while deny / ask match any sub-command</td></tr>
<tr><td><b>Layered settings</b></td><td>Permission rules merge from three scopes (global user / committable project / gitignored local), always deny-beats-allow-beats-ask; command hooks load only for trusted workspaces</td></tr>
<tr><td><b>Bash risk classification</b></td><td>Each command is graded read / write / network / destructive with a reason, surfaced right on the prompt</td></tr>
<tr><td><b>Denial-loop protection</b></td><td>After the same kind of call is rejected repeatedly, the loop nudges the model to change approach instead of grinding</td></tr>
</tbody>
</table>

**Tools & extensibility**

<table>
<thead><tr><th>Capability</th><th>What it does</th></tr></thead>
<tbody>
<tr><td><b>Built-in tool set</b></td><td>Read / Write / Edit / Glob / Grep / Bash, reading and writing real files and running real commands; Glob and Grep are pure-Node, with no ripgrep dependency</td></tr>
<tr><td><b>TodoWrite task list</b></td><td>Maintains a live session task list (exactly one item in progress at a time), shows it to you, and nudges you to run verification before marking 3+ items done</td></tr>
<tr><td><b><code>Task</code> sub-agent delegation</b></td><td>Dispatches a specialized sub-agent (builder / read-only explorer / custom) to work in a fresh context and return only a distilled report; sub-agents are structurally barred from nesting again</td></tr>
<tr><td><b><code>Skill</code></b></td><td>Reusable prompt recipes defined in SKILL.md (with <code>$ARGUMENTS</code> / <code>${SKILL_DIR}</code>) become model-callable (also <code>/name</code>-callable) tools, expanded inline or forked into a restricted sub-agent</td></tr>
<tr><td><b>Passive auto-memory</b></td><td>Each turn auto-injects the project <code>/memories/MEMORY.md</code> index (capped at 4000 chars) into context, recalling prior work without spending a tool call</td></tr>
<tr><td><b><code>memory</code> tool</b></td><td>Model-driven memory sandboxed to <code>/memories</code> (view/create/str_replace/insert/delete/rename); persistent notes survive compaction and survive across sessions</td></tr>
<tr><td><b>WebSearch / WebFetch</b></td><td>Optional read-only web tools behind a WebClient port, registered only when config explicitly enables them (<code>AGENT_WEB=1</code>)</td></tr>
<tr><td><b>Output styles</b></td><td>Drop-in markdown style files reshape how the model responds, switchable live in-session via <code>/output-style</code></td></tr>
<tr><td><b>settings.json command hooks</b></td><td>PreToolUse / PostToolUse hooks shell out to any command (deny/ask/rewrite the input) for validation, formatting, audit logging; project hooks load only for trusted workspaces, with a global kill switch</td></tr>
<tr><td><b>Tool-output spill to disk</b></td><td>Each tool can declare its own max output size; oversized output spills to <code>.blazecoder/tool-results</code>, leaving only a head/tail preview to read back, instead of flooding context</td></tr>
</tbody>
</table>

## 🏗️ Architecture

The agent loop is deliberately "dumb": assemble context, call the model, run tools, feed results back, repeat.

```
                    ┌─────────────────────────────────────────┐
                    │                                          │
                    ▼                                          │
  you  ──▶ [ gather context ] ──▶ [ call model ] ──▶ tool calls?
              ▲                                  │
              │                            yes   │   no
  steering    │                  ┌──────────────┴───────┐
  (type while │                  ▼                      ▼
   it runs)   │           [ permission gate ]     [ done / reply ]
              │                  │
              │          allow / ask / deny
              │                  ▼
              └────────  [ run tools, feed results back ]
                                 │
                  (uncapped by default · auto-compacts when the 1M window fills)
```

Ports and adapters: the kernel is host-agnostic, runs in-process, and serves no HTTP.

```
   @blazecoder/shared      types, validation, secret patterns (no deps)
          ▲
   @blazecoder/core        the agent kernel: loop, tools, permissions, context
          ▲                engine. host-agnostic, fully unit-tested
   @blazecoder/host        Node/OS wiring: filesystem, providers, config, sessions
          ▲
     ┌────┴─────┐
 @blazecoder/   @blazecoder/
    cli            desktop      ← sibling UI adapters
  (Ink TUI)      (Electron)        desktop never imports cli / Ink
```

<sub>The kernel publishes as <code>@blazecoder/core</code> (its directory is <code>packages/agent-core</code>). The two UI adapters are equal siblings with no cross-dependency edge, a structural constraint enforced by a guard test, and the most important architectural selling point of the project.</sub>

## ⚙️ Configuration

Your credentials are written to `~/.blazecoder/config.json` by the guided setup (`./install.sh`, first launch, or `blazecoder --setup`). **You never edit a file by hand, and there are no `.env` files.**

The environment variables below are all optional overrides for CI and advanced use; real environment variables always win. Thinking depth (`low` / `high` / `ultra`) maps to DeepSeek's three native thinking modes and **controls reasoning depth only, never output length**.

**Permission modes**

<table>
<thead><tr><th>Mode</th><th>Behavior</th></tr></thead>
<tbody>
<tr><td><code>default</code></td><td>Asks before any file write / command run</td></tr>
<tr><td><code>acceptEdits</code></td><td>Auto-approves file edits, still asks for commands</td></tr>
<tr><td><code>auto</code></td><td>Full autonomy, no prompts; protected paths, secrets guard, and the catastrophic tripwire still apply</td></tr>
<tr><td><code>plan</code></td><td>Read-only; denies every non-read-only tool</td></tr>
<tr><td><code>bypass</code></td><td><code>--yolo</code>, allows everything (dangerous, trusted CI only)</td></tr>
</tbody>
</table>

**Optional environment variables**

<table>
<thead><tr><th>Variable</th><th>Default</th><th>Effect</th></tr></thead>
<tbody>
<tr><td><code>DEEPSEEK_API_KEY</code></td><td>(saved by setup)</td><td>Overrides the stored key (CI / temporary); with nothing configured at all it falls back to an offline stub</td></tr>
<tr><td><code>BLAZECODER_MODEL</code></td><td><code>deepseek-v4-pro</code></td><td>Overrides the current model id</td></tr>
<tr><td><code>AGENT_MAX_TURNS</code> · <code>AGENT_MAX_BUDGET_USD</code></td><td>unset = no limit</td><td>Optional tool-turn / cost ceilings, off by default</td></tr>
<tr><td><code>AGENT_MAX_OUTPUT_TOKENS</code></td><td>unset = model max 384K</td><td>Optional output cap; unset means full, shrunk dynamically by window</td></tr>
<tr><td><code>AGENT_WEB</code> · <code>AGENT_FAKE_MODEL</code></td><td>off · off</td><td>Enable the web tools · use the offline stub model (try the whole UI with no key)</td></tr>
</tbody>
</table>

Credentials live in `~/.blazecoder/config.json` (mode 600, written atomically). Sessions and cross-session memory are isolated per project under `~/.blazecoder/projects/<project-key>/`, so they never cross-contaminate. The permission settings files (`.blazecoder/settings.json` committable, `settings.local.json` best gitignored) travel with the repo.

## 🚦 CLI reference

<table>
<thead><tr><th width="34%">Flag</th><th>What it does</th></tr></thead>
<tbody>
<tr><td><code>blazecoder</code></td><td>Launch the terminal TUI in the current directory</td></tr>
<tr><td><code>--gui</code> · <code>--desktop</code></td><td>Launch the desktop GUI (Electron) instead of the terminal</td></tr>
<tr><td><code>--cwd &lt;dir&gt;</code></td><td>Working directory the agent operates in (default: current dir)</td></tr>
<tr><td><code>--effort &lt;level&gt;</code></td><td>Thinking depth: <code>low</code> | <code>high</code> | <code>ultra</code> (default high)</td></tr>
<tr><td><code>-c</code>, <code>--continue</code></td><td>Resume the most recent session</td></tr>
<tr><td><code>--resume [id]</code></td><td>Resume a session by id; omit the id to list recent sessions</td></tr>
<tr><td><code>-p</code>, <code>--print &lt;text&gt;</code></td><td>Run one prompt headless and print the result (scripts / CI)</td></tr>
<tr><td><code>--output-format &lt;format&gt;</code></td><td>Headless output: <code>text</code> | <code>json</code> | <code>stream-json</code></td></tr>
<tr><td><code>--setup</code></td><td>Connect / switch the model provider and API key, then exit</td></tr>
<tr><td><code>-v</code> · <code>-h</code></td><td>Version · help</td></tr>
</tbody>
</table>

<sub>In-session slash commands too: <code>/effort</code>, <code>/resume</code>, <code>/skill</code>, <code>/output-style</code>, <code>/context</code>, <code>/usage</code>, <code>/compact</code>, <code>/changes</code>, <code>/clear</code>, <code>/help</code>.</sub>

## 🧩 Extending

Drop a file and it takes effect, no rebuild needed. User scope (`~/.blazecoder/…`) always loads; project scope (`<repo>/.blazecoder/…`) requires **trusting the workspace** first.

<details>
<summary><b>Skill</b> &nbsp;<code>&lt;repo&gt;/.blazecoder/skills/&lt;name&gt;/SKILL.md</code></summary>

<br>

```markdown
---
name: review-pr
description: Review workspace changes for bugs and style
context: inline          # inline (body returned verbatim) | fork (run as a sub-agent)
allowedTools: [Read, Grep, Bash]   # fork only
---
Review the part of `git diff` about $ARGUMENTS. The skill files live at ${SKILL_DIR}.
```

</details>

<details>
<summary><b>Sub-agent</b> &nbsp;<code>&lt;repo&gt;/.blazecoder/agents/&lt;name&gt;.md</code></summary>

<br>

```markdown
---
name: explorer
description: Read-only codebase explorer
tools: [Read, Grep, Glob]
maxTurns: 12
---
You are a focused codebase explorer. Report findings concisely and never modify files.
```

</details>

<details>
<summary><b>Output style</b> &nbsp;<code>&lt;repo&gt;/.blazecoder/output-styles/&lt;name&gt;.md</code></summary>

<br>

```markdown
---
name: terse
description: One-sentence answers
keepCodingInstructions: true   # true appends to the base prompt; false replaces it
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

Command hooks run arbitrary shell, so project-scope hooks load only for **trusted workspaces**; `BLAZECODER_DISABLE_HOOKS=1` is the global kill switch.

</details>

<details>
<summary><b>Add a model provider</b> &nbsp;<code>packages/host/src/providers/&lt;name&gt;.ts</code></summary>

<br>

Every model backend lives behind one `Provider` interface (auth header, base URL, request body, streaming format, tool schema, reasoning field). Wiring up Gemini / Claude is writing one provider file and adding one line to the `PROVIDERS` array in `registry.ts`; the guided setup lists it automatically.

</details>

## 🛠️ Develop

A pnpm + Turborepo monorepo.

```bash
pnpm install
pnpm --filter @blazecoder/cli build    # produces packages/cli/dist/blazecoder.js
pnpm desktop                           # desktop GUI dev mode (Vite HMR + Electron)

pnpm typecheck    # all packages
pnpm test         # unit + integration + e2e (548)
pnpm build        # build everything
```

Workspace layout: `packages/{shared, agent-core, host, cli, desktop}`. `agent-core` runs its full unit suite with in-memory fakes; end users run `blazecoder --gui` (which loads the built GUI), while `pnpm desktop` is the hot-reload dev command (needs a graphical display).

## 📄 License

<a href="LICENSE"><b>MIT</b></a> © 2026 Zephyr Huang &nbsp;·&nbsp; <a href="README.md">简体中文</a>
