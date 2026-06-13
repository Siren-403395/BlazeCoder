# Coding Agent

A Claude-Code-style **coding agent**: describe an app in natural language and an
agentic loop writes a runnable React + TypeScript + Vite project, builds a live
preview, fixes its own build errors, and lets you export the result.

The architecture is grounded in how Claude Code / the Claude Agent SDK actually
work — see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full rationale
and primary-source citations.

## What makes it an *agent* (not a prompt chain)

One model-driven loop — **gather context → act → verify → repeat** — until the
model stops calling tools:

```
prompt → [model] → tool calls (write_file / edit_file / build_preview / …)
       → tool results fed back → [model] → … → done
```

Built-in tools: `list_files`, `read_file`, `write_file`, `edit_file`,
`delete_file`, `grep`, `glob`, `build_preview`, `run_command`, `memory`.
The loop is bounded by **our** caps (max turns, max budget $) and guarded by a
permission engine, hooks, and graduated context compaction.

## Layout (pnpm + Turborepo monorepo)

```
packages/
  shared/      types shared FE↔BE (project schema, event stream, validation)
  agent-core/  the framework-agnostic, unit-tested engine:
               loop · context (compaction/memory) · tools · permissions/hooks
               · sessions · orchestration — depends only on injected ports
apps/
  server/      thin Fastify adapter: SSE run endpoint + DeepSeek gateway +
               standalone-esbuild preview builder + sandbox port
  web/         thin React client: streams events, renders preview / files /
               trace / context gauge; client-side zip export
docs/ARCHITECTURE.md
```

`agent-core` contains **no** Fastify, React, or DeepSeek imports — everything
crosses the boundary through ports (`ModelGateway`, `Workspace`,
`PreviewBuilder`, `Sandbox`, `SessionStore`, `MemoryStore`, `Clock`), so it runs
fully under unit tests with in-memory fakes.

## Quick start

```bash
pnpm install

# configure the model (DeepSeek, OpenAI-compatible). Without a key the server
# falls back to a deterministic offline stub model.
cp .env.example .env   # then set DEEPSEEK_API_KEY

pnpm dev               # runs server (:8787) + web (:5173) together
# open http://localhost:5173
```

Run them separately with `pnpm dev:server` / `pnpm dev:web`.
Force the offline stub model with `AGENT_FAKE_MODEL=1`.

## Verify

```bash
pnpm typecheck   # all packages
pnpm test        # unit + integration + e2e
```

- **Unit** — every `agent-core` module (tools, executor, permission gates,
  compaction, memory sandbox, sessions) and the shared validation + web reducer.
- **Integration** — the full loop end to end with a scripted model + fakes.
- **E2E** — boots the real Fastify server, drives it over HTTP/SSE with a stub
  model and the **real esbuild** preview builder, asserting the generated app
  actually compiles.

## Extending

- **New tool** → add a `Tool` in `agent-core/src/tools/builtin/` and register it.
- **New guardrail** → register a `PreToolUse` / `PostToolUse` hook (no loop changes).
- **New model** → implement the `ModelGateway` port (one adapter).
- **New sub-agent** → a row in the agent registry (data, not code).

Sandboxed shell (`run_command`) is disabled by default; wire a real container
`Sandbox` adapter to enable it. Browser-level UI e2e (Playwright) is a planned
addition on top of the existing reducer + server e2e coverage.
