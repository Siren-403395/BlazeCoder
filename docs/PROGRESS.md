# zephyrcode ⇽ claude-code-best integration — progress tracker

Blueprint: `docs/INTEGRATION_SPEC.md`. Detailed per-task design+testPlan: `docs/_research_tasks.json` (gitignored scratch).
Rule: every task = implement → unit+integration/e2e tests green → commit. No backward-compat shims; legacy retired in place.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done (committed)

## P0 — highest-leverage parity
- [x] P0-tools-1   shared TOOL_NAMES constant + fix prompt↔registry name-drift bug
- [x] P0-prompts-2 sectioned composable system-prompt builder (string[]), port counterweight prose, keep identity   (deps: tools-1)
- [x] P0-context-1 type-aware token estimation + authoritative real input_tokens
- [ ] P0-context-2 whitelist tool-result clearing + post-compact fresh file rehydration   (deps: context-1)
- [ ] P0-perm-1    permission rule grammar + per-tool matchers (Bash prefix/wildcard, file globs)
- [ ] P0-perm-2    rewrite PermissionEngine: behavior-priority over layered rules + decisionReason   (deps: perm-1)
- [ ] P0-perm-3    persisted layered settings store + PermissionUpdate pipeline via buildRuntime   (deps: perm-2)
- [ ] P0-harness-1 model-call retry/backoff/timeout in DeepSeek gateway + api_retry event
- [ ] P0-harness-2 typed transition/Terminal state machine in the loop
- [ ] P0-tools-2   TodoWrite tool (reference-grade prompt, content/activeForm, verify nudge, todos event)   (deps: tools-1)
- [ ] P0-orch-2    wire runSubagent as a model-callable Task tool via AgentRegistry, no-nest   (deps: tools-1)
- [ ] P0-ext-1     wire the 4 dead HookBus lifecycle events (PreCompact/SessionStart/SessionEnd/Stop)

## P1 — strong additions
- [ ] P1-context-3 compaction boundary marker + tool_use/tool_result pairing across the split   (deps: context-2)
- [ ] P1-context-4 consecutive-failure circuit breaker + PROMPT_TOO_LONG head-truncation escape   (deps: context-2)
- [ ] P1-context-5 harden summarization prompt (no-tools guard, analysis scratchpad, all-user-msgs, next-step)   (deps: context-4)
- [ ] P1-perm-4    always-allow suggestions + [once/always-local/always-project/no] ask flow   (deps: perm-3)
- [ ] P1-harness-3 between-turns steering queue + blocking Stop hook   (deps: harness-2, ext-1)
- [ ] P1-harness-4 recover from output truncation (max_tokens) instead of terminating   (deps: harness-2)
- [ ] P1-orch-3    per-agent tool-pool filtering, no-nest depth, subagent AgentEvent arm   (deps: orch-2)
- [ ] P1-orch-1    fix stale tool names in DEFAULT_AGENTS + agent-tools regression test   (deps: tools-1)
- [ ] P1-orch-4    .zephyrcode/agents markdown loader (built-in/user/project merge)   (deps: orch-1, ext-3)
- [ ] P1-ext-2     markdown SKILL loader + model-callable skill tool + /skill palette   (deps: orch-2, ext-3)
- [ ] P1-ext-3     settings.json hooks reader + command-hook subprocess executor (trust gate)   (deps: perm-3, ext-1)
- [ ] P1-ext-4     plan-mode allowedPrompts (pre-approved categories on plan exit)   (deps: perm-2)
- [ ] P1-tools-3   upgrade Read/Write/Edit/Glob/Grep/Bash descriptions to reference-grade   (deps: tools-1)
- [ ] P1-tools-4   WebSearch + WebFetch behind a WebClient port, mandatory Sources citation   (deps: tools-1)

## P2 — nice-to-have
- [ ] P2-tools-5   per-tool maxResultSizeChars with disk-spill-and-pointer (replace flat 60k cap)   (deps: tools-3)
- [ ] P2-tools-6   searchHint + CORE_TOOLS allowlist scaffolding for deferred-tool loading   (deps: tools-2, orch-2)
- [ ] P2-context-6 cache discipline: stable prefix + cache-token telemetry + compaction logging   (deps: context-1)
- [ ] P2-context-7 optional live session-notes file as a zero-cost summary source   (deps: context-3)
- [ ] P2-perm-5    denial-loop protection in the agent loop   (deps: perm-2, harness-2)
- [ ] P2-harness-5 synthetic tool_result blocks for orphaned tool_use on abort/error   (deps: harness-2, harness-3)
- [ ] P2-harness-6 reactive compaction on context-overflow rejection (retry once, gated)   (deps: harness-2, context-4)
- [ ] P2-harness-7 config/deps/state three-way split (loop as near-pure reducer)   (deps: harness-2, harness-3, harness-4)
- [ ] P2-ext-5     markdown output-style loader feeding buildSystemPrompt   (deps: prompts-2)
- [ ] P2-ext-6     design-only: MCP as a ToolSource port (mcp__server__tool)   (deps: perm-1, tools-6)
