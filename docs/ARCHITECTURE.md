# Coding Agent Infra — Architecture Grounding

> The canonical design rationale for this repo. Grounded in how Claude Code / the Claude Agent SDK are actually architected (citations inline), produced from a large-scale primary-source research pass. Read this before changing the `agent-core` contracts.

---

## 0. Form factor: a local CLI/TUI agent (read this first)

This repo shipped as a **command-line agent** (`ca`), not a browser app. The kernel
rationale in the sections below is model/form-agnostic and still holds, but the
substrate and frontend changed — where older text says "GeneratedProject graph",
"preview", "frontend/web", or "Fastify server", read it as:

- **Real filesystem, not a virtual project graph.** The `Workspace` port is now an
  async, boundary-aware view of the real working directory: `FileSystemWorkspace`
  with a realpath-canonicalized + symlink-checked boundary, a `.gitignore`-aware
  bounded `walk()`, and a **read-before-edit ledger** (Read stamps a file; Write/Edit
  refuse to touch an unread, deleted, or externally-changed file). `GeneratedProject`
  is gone; a session stores its `cwd` + transcript.
- **Tools at Claude-Code parity:** `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`,
  `memory` (the SPA-only `build_preview` was removed; `Bash` is how the agent
  verifies). A secrets deny-list blocks reading/writing/searching credential files.
- **Frontend = an Ink TUI, in-process.** `packages/cli` imports the `AgentRuntime`
  directly and consumes its `EventSink` — there is no HTTP server or SSE. A headless
  `--print` mode (text/json/stream-json) serves scripting and CI. `apps/web` and
  `apps/server` were deleted.
- **Real command execution.** `LocalProcessSandbox` runs `Bash` as child processes
  (timeout, process-group kill, abort, output cap), gated by the permission engine.
- **Deep-thinking → `/effort`.** The old thinking boolean became an effort ladder
  (`low|medium|high|ultra`, mapped to thinking-on/off + output budget) plus a
  per-turn "ultrathink" keyword escalation and a `/reasoning` display knob.

Package layout: `packages/{shared, agent-core, cli}` (no `apps/`).

---

## 1. Coding Agent — definition

A coding agent is **not** a fixed prompt chain. Per Anthropic, "agents are typically just LLMs using tools based on environmental feedback in a loop" ([building-effective-agents](https://www.anthropic.com/engineering/building-effective-agents)), and Claude Code is the **agentic harness** that "provides the tools, context management, and execution environment that turn a language model into a capable coding agent" ([how-claude-code-works](https://code.claude.com/docs/en/how-claude-code-works)). Every task blends three phases the model itself sequences: **gather context → take action → verify results**, repeated until done. Two components power it: "models that reason and tools that act."

This reframes our V1. The linear Intent→Planner→CodeGenerator→OutputReview→Preview chain is a *workflow*, not an agent — it can't loop to fix its own build errors. Our core is one autonomous loop that decides each step, calls tools (read/write/edit/preview/validate), reads back environmental feedback, and re-iterates until verification passes or a budget cap trips. The model decides "done" by emitting no further tool calls ([agent-loop](https://code.claude.com/docs/en/agent-sdk/agent-loop)). We keep a predictable spine (a deterministic Intent/Planner pre-step is optional) and hand off to the agentic loop.

---

## 2. CONTEXT architecture we adopt

**Core principle:** the context window is the primary scarce resource. Attention is an n² budget that produces "context rot" — recall degrades as tokens grow ([context-engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)). The backend must curate the *smallest high-signal token set* and **never serialize the whole `GeneratedProject` graph into the model**. Anthropic measured memory+context-editing at **+39% over baseline** and **84% token reduction** on a 100-turn eval ([context-management](https://claude.com/blog/context-management)). The frontend stays dumb (renders a budget gauge); the backend owns all of this.

We make **`SessionContext` a first-class backend aggregate** that token-counts every block (system prompt, project rules, tool defs, history, file reads, tool results) and exposes remaining budget. We mirror Anthropic's signal shape: emit a one-time budget total and a per-tool-call `used/total; remaining` update, streamed to the frontend's "context left" bar ([context-windows](https://platform.claude.com/docs/en/build-with-claude/context-windows)). This gauge is the **deterministic trigger** for each compression stage. Thresholds are tuned to DeepSeek's real window, **not** copied from Claude's 200K/1M.

**Mechanism A — Graduated, cheapest-first compression** (mirrors Claude Code's documented "clear older tool outputs first, then summarize if needed"):
1. **Spill** any oversized single tool/command output to the object store; keep a ~2KB preview + `saved to <path>` placeholder.
2. **Clear old tool RESULTS in place** keeping the most recent N (default 3), marker `[tool result cleared]`, **no LLM call** (our `clear_tool_uses_20250919` analog). Add a `clear_at_least` gate so we only rewrite — and invalidate the prompt-cache prefix — when savings justify it ([context-editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)).
3. **Only then** run LLM summarization.

**Mechanism B — Summarization as a typed contract** (not free-form). Replace the message log with one replaceable summary block carrying: user intent, key technical concepts, files touched + load-bearing snippets, errors + their fixes, pending tasks, current work — explicitly **dropping** verbatim tool outputs and intermediate reasoning ([context-window](https://code.claude.com/docs/en/context-window)). After summarizing we run a **deterministic rehydration**: re-inject durable context from disk (project manifest, memory index) + re-attach invoked skill/tool bodies (cap 5K each / 25K total, oldest dropped first). Re-injecting the **tool/skill catalog** on rehydration is required because Claude Code loses awareness of *non-invoked* skills post-compact.

**Mechanism C — Compaction circuit breaker.** Track consecutive summarizations that fail to free meaningful space; after a **tunable** threshold (the community "3" is *not* an official constant) STOP and surface an actionable error ("input too large — delegate to a sub-task, /clear, or shrink the file") instead of looping. This is Claude Code's documented "thrashing error" ([how-claude-code-works](https://code.claude.com/docs/en/how-claude-code-works)).

**Mechanism D — Two-layer durable memory.**
- *Human/project layer* (our CLAUDE.md analog): framework, conventions, current file-graph, acceptance criteria — injected as a synthetic **user message AFTER the system prompt** (advisory, keeps system prompt cacheable, survives compaction) ([memory](https://code.claude.com/docs/en/memory)). Ordered concatenation org→user→project→local with directory-walk discovery, lazy subdir loading, an `@import` primitive (resolve relative, cap recursion at **4 hops**), and an always-loaded `MEMORY.md`-style index capped ~200 lines / 25KB.
- *Model-driven memory tool* — exact `memory_20250818` vocabulary (`view/create/str_replace/insert/delete/rename`), documented return-string contracts, 6-char right-aligned 1-indexed `view` line numbers, sandboxed to `/memories` ([memory-tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)). We **reuse our validation primitive** to enforce path-traversal protection (paths start with `/memories`, resolve canonical + assert containment, reject `../ ..\ %2e%2e%2f`). Fire a **flush-to-memory** step *before* any tool-result eviction. Key the store per-project.

**Mechanism E — Just-in-time retrieval (tool layer enforces discipline).** Expose `list_files` (path+size+mtime as progressive-disclosure signal), `read_file(path, line_range)`, `grep`, `glob` over the graph; keep only lightweight **path references** in context. Cap every tool response (~25K tokens) with truncation+pagination+range params; add a `response_format: 'concise'|'detailed'` enum; return semantic identifiers (paths, symbol names) not opaque UUIDs; defer tool/MCP schemas (names first, full schema on demand) ([writing-tools](https://www.anthropic.com/engineering/writing-tools-for-agents)).

**Mechanism F — Sub-agent isolation** (the strongest context lever). Sub-agents run in a **fresh context window**, receive ONLY the Agent-tool prompt string (no parent history/system prompt), can be tool-restricted, **cannot nest**, and return only a distilled ~1–2K-token final message ([subagents](https://code.claude.com/docs/en/agent-sdk/subagents)). We store child transcripts **separately** so they survive parent compaction.

---

## 3. HARNESS architecture we adopt

**Core loop** — keep it dumb; invest in the agent-computer interface ([building-effective-agents](https://www.anthropic.com/engineering/building-effective-agents)). The loop is ignorant of permissions, compaction, and persistence — those are sibling modules it calls into.

```
async function* runAgentLoop(session, userPrompt):
  emit { type: 'system', subtype: 'init', sessionId, model, tools }
  session.appendUser(userPrompt)
  turns = 0
  while true:
    request   = contextManager.assemble(session)        # stable cached prefix + rules + history
    response  = modelGateway.complete(request)           # text + tool_use[] (streams deltas)
    emit { type: 'assistant', text, toolCalls }
    if response.toolCalls.isEmpty():                      # model-decided DONE
      return result('success', stopReason='end_turn', cost, turns, sessionId)
    if ++turns > session.maxTurns:  return result('error_max_turns', ...)
    if session.costUsd > session.maxBudgetUsd: return result('error_max_budget_usd', ...)

    # parallel gate by mutation: read-only concurrent, mutating sequential
    readOnly  = response.toolCalls.filter(isReadOnly)
    mutating  = response.toolCalls.filter(not isReadOnly)
    results   = [ ...await Promise.all(readOnly.map(exec)), ...await sequential(mutating, exec) ]
    for r in results: emit { type: 'toolResult', toolUseId: r.id, content, isError }
    session.appendToolResults(results)

    contextManager.maybeCompact(session)                 # spill→clear→summarize; emits compact_boundary

async function exec(call):
  decision = permissionEngine.check(call, session)       # hooks→deny→ask→mode→allow→callback
  if decision.behavior == 'deny': return { isError: true, content: decision.message }
  return await toolExecutor.run(call.name, decision.updatedInput ?? call.input, ctx)
```

Termination is model-decided (stop when no tool calls; `stop_reason` ∈ `end_turn|max_tokens|stop_sequence|refusal`) but **bounded by OUR caps** — both `maxTurns` (counts tool-use turns only) and `maxBudgetUsd` default to *no limit* in the SDK, so we set production defaults ourselves ([agent-loop](https://code.claude.com/docs/en/agent-sdk/agent-loop)). The typed `Result` carries `{subtype ∈ success|error_max_turns|error_max_budget_usd|error_during_execution, total_cost_usd, usage, num_turns, session_id, stop_reason}`.

**Components & how we build each:**

- **Model Gateway** — one "augmented model call" service: `(systemPrompt + toolSchemas + history) → (text + tool_use[])`. Wraps DeepSeek chat/completions, normalizes to a provider-agnostic message contract so a model swap is one adapter. Prompt-caches the stable prefix; supports streaming deltas.
- **Tool Registry** — each tool = `{ name /^[a-zA-Z0-9_-]{1,64}$/, description (3-4 sentences w/ examples + absolute-path convention), inputSchema (JSON-Schema), execute(input, ctx) → {content, structuredContent?, isError}, readOnlyHint }`. Description quality is load-bearing. **Survival rule: handlers RETURN `isError:true` on failure, never throw** — a throw kills the whole query; `isError` keeps the loop alive to self-correct ([custom-tools](https://code.claude.com/docs/en/agent-sdk/custom-tools)).
- **Tool Executor** — runs tools, enforces the parallel-by-mutation gate (read-only concurrent; Edit/Write sequential), per-tool wall-clock timeouts, 25K-token response cap with persist-to-disk-and-reference. Implements Claude Code invariants: read-before-edit + exact-unique-match (or `replace_all`); Write requires prior read of an existing target ([tools-reference](https://code.claude.com/docs/en/tools-reference)).
- **Session/State** — JSONL-style transcript behind a pluggable `SessionStore` so any worker can run a session. `session_id` is the client handle. Implement `resume / continue / fork`. **Sessions persist the CONVERSATION only** — file undo is a *separate* checkpoint mechanism ([sessions](https://code.claude.com/docs/en/agent-sdk/sessions)).
- **Event Stream** — typed feed copied from SDK message types: `init → assistant(text+tool_use) → toolResult → compact_boundary → permissionRequest → result`. **Structured/final artifacts ride the final `result`, never the deltas** ([streaming-output](https://code.claude.com/docs/en/agent-sdk/streaming-output)).
- **Permission Engine** — ordered gates `hooks → deny → ask → mode → allow → canUseTool callback` ([permissions](https://code.claude.com/docs/en/agent-sdk/permissions)). `PermissionResult` is **ALLOW|DENY only** (`{behavior:'allow', updatedInput}` / `{behavior:'deny', message}`). Modes `default/acceptEdits/plan/bypassPermissions`. A hardcoded **protected-paths** set is checked **before** allow rules.
- **Hooks** = the primary extension seam (new guardrails need zero core changes): `PreToolUse (allow|deny|ask + updatedInput)`, `PostToolUse (updatedToolOutput|block)`, `UserPromptSubmit`, `Stop`, `SessionStart/End`, `PreCompact`. Our validation gate wires in as a built-in PreToolUse hook; a formatter/linter as PostToolUse.

---

## 4. INFRA blueprint

**Hard frontend/backend boundary.** The frontend NEVER executes tools, reads files, or assembles context — it sends `intent + lightweight references` and renders a normalized event stream. The backend `agent-core` owns the loop, registry, executor, sessions, permissions, context, and sub-agent orchestration. `agent-core` is **framework-agnostic and unit-testable**: it depends only on injected ports (`ModelGateway`, `Workspace`, `SessionStore`, `PreviewBuilder`, `Sandbox`, `Clock`) — no Fastify, no React, no DeepSeek import inside the loop. The HTTP server is a thin adapter that exposes `agent-core` over SSE.

```
repo/
├─ packages/
│  ├─ shared/              # types shared FE<->BE (projectSchema, events, validation)
│  └─ agent-core/          # PURE, framework-agnostic, 100% unit-testable
│     ├─ loop/             # the while(tool_use) loop + Result types
│     ├─ context/          # sessionContext (budget) + compaction + rehydration
│     ├─ memory/           # memory tool (memory_20250818) + project-rules loader
│     ├─ tools/            # registry + executor + builtin/ (read/write/edit/glob/grep/preview/run)
│     ├─ permissions/      # ordered gates + protectedPaths + hooks bus
│     ├─ orchestration/    # subagent (no-nesting) + agent registry
│     ├─ session/          # SessionStore port + in-memory/FS impls
│     ├─ events/           # event factory (types live in shared)
│     └─ ports.ts          # ModelGateway, Workspace, PreviewBuilder, Sandbox, Clock
├─ apps/
│  ├─ server/              # THIN adapter — Fastify + SSE; DI of agent-core + adapters
│  │  └─ adapters/         # deepseekGateway, esbuildPreviewBuilder, sandbox
│  └─ web/                 # THIN React 19 + Vite client (chat / preview / fileTree / budget / trace)
└─ docs/ARCHITECTURE.md
```

**Extension points (first-class):**
- **New tool** → add a file under `tools/builtin/` + register. Nothing else changes.
- **New skill/capability** → drop a `SKILL.md` folder; three-level progressive disclosure (L1 manifest always loaded; L2 body on trigger; L3 files lazy). Description-based routing ([skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)).
- **New MCP server / transport** → the tool-call contract is transport-agnostic; provide in-process / stdio / HTTP adapters ([MCP architecture](https://modelcontextprotocol.io/docs/learn/architecture)).
- **New sub-agent type** → a row in `agentRegistry` (data, not code).

---

## 5. Salvage map (from V1)

| V1 asset | Moves to | Why |
|---|---|---|
| `previewRuntimeService.ts` (esbuild + module-graph) | `apps/server/adapters/esbuildPreviewBuilder.ts` behind a `PreviewBuilder` port; exposed as a `build_preview` tool | Converts one-shot preview into a self-correcting build-fix loop (verify phase). De-couple from Vite's dep-optimizer paths → standalone esbuild + CDN React. |
| `projectExport.ts` (JSZip) | `apps/web/features/preview` (client-side export) | Web accumulates the file graph from `file_change` events; export is a pure client action. |
| `projectSchema.ts` (GeneratedProject) | `packages/shared/projectSchema.ts` | The file-graph contract shared FE↔BE; the substrate `list_files/read_file` operate over. |
| `projectValidation.ts` | `packages/shared/validation.ts`, wired as a built-in PreToolUse hook + reused by the memory-tool sandbox | Deterministic enforcement that runs *regardless of model output*; returns actionable errors so the model self-corrects. |
| `server/deepseek*Service.ts` | `apps/server/adapters/deepseekGateway.ts` implementing `ModelGateway` | Real value, but sits behind the gateway port so `agent-core` never imports DeepSeek. Keep robust JSON/normalization patterns. |
| `workspace/agents/*` (linear pipeline) | repurposed: code-gen/review/preview become **tools** the loop calls | The separation is decent but the fixed chain isn't agentic. |
| `src/main.tsx` (518-line monolith) | decomposed into `apps/web/features/*` | Monolith; violates the thin-client principle. |

**Deleted:** `python_server.py` (legacy mock backend, second language), the Vite-embedded API middleware (the dev-server-as-backend boundary violation we're fixing), the monolithic `main.tsx`.

---

## 6. Tech decisions

- **Backend: Node + TypeScript, Fastify.** Single language across the stack (share `packages/shared` types), no Python; Fastify is lean with first-class streaming.
- **`agent-core` is plain TS with injected ports.** Framework-agnostic + unit-testable (vitest with in-memory fakes).
- **Transport: HTTP + SSE for the agent event stream; a POST endpoint resolves permission round-trips.**
- **Monorepo: pnpm workspaces + Turborepo.** Clean package boundaries, enforced layering.
- **Preview: standalone esbuild server-side + React from a CDN (esm.sh) in the iframe.** Reuses the working "it runs" loop, removes V1's Vite coupling, works in the separated backend. (Owner-fork: could move to client-side esbuild-wasm later.)
- **Sandbox: a `Sandbox` port with a safe `DisabledSandbox` default.** Real container isolation (Docker/Firecracker-class, deny-read secrets, egress allowlist) is the documented backstop for shell execution and is wired as a port to add when `run_command` is enabled ([sandboxing](https://code.claude.com/docs/en/sandboxing)).

---

## 7. Owner-decision forks (deferred, not blocking)

1. **Preview execution location** — server-side esbuild now (chosen) vs client-side esbuild-wasm later.
2. **Self-hosted SDK shape vs hosted managed sandbox** — we build the SDK shape (loop in our process) now.
3. **Compaction thresholds** — undocumented by Anthropic; pick empirically against DeepSeek's real window (start ~80–85%).
4. **Sub-agent fan-out scope** — multi-agent gives ~90% lift but ~15× tokens; start single-loop + read-only sub-agents for exploration/review only.

---

## 8. Key citations

- **Agent loop**: https://code.claude.com/docs/en/agent-sdk/agent-loop
- **How Claude Code works**: https://code.claude.com/docs/en/how-claude-code-works
- **Context window**: https://code.claude.com/docs/en/context-window
- **Context editing / Compaction**: https://platform.claude.com/docs/en/build-with-claude/context-editing · https://platform.claude.com/docs/en/build-with-claude/compaction
- **Memory tool + CLAUDE.md**: https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool · https://code.claude.com/docs/en/memory
- **Permissions / modes / sandboxing**: https://code.claude.com/docs/en/agent-sdk/permissions · https://code.claude.com/docs/en/permission-modes · https://code.claude.com/docs/en/sandboxing
- **Subagents**: https://code.claude.com/docs/en/agent-sdk/subagents
- **Custom tools**: https://code.claude.com/docs/en/agent-sdk/custom-tools
- **Writing tools for agents / Building effective agents**: https://www.anthropic.com/engineering/writing-tools-for-agents · https://www.anthropic.com/engineering/building-effective-agents
- **Long-running harnesses**: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
