# blazecoder ⇽ claude-code-best: Authoritative Integration Spec

## Executive summary

Seven specialists deep-researched a high-fidelity Claude Code clone (`claude-code-best`) across prompts, context, permissions, harness, tools, orchestration, and extensibility. This spec merges their findings into one prioritized blueprint that upgrades blazecoder while preserving three non-negotiables:

1. **Ports & adapters integrity** — every new capability lands behind an injected port or in a sibling module; the loop stays a near-pure reducer; `agent-core` stays host-agnostic (the DeepSeek gateway, OS sandbox, settings files, web client are all CLI adapters).
2. **Product identity** — blazecoder stays `blazecoder`; it must never claim to be Claude/DeepSeek/Anthropic. All ported prompt prose is scrubbed of brand/identity references; the existing identity section is preserved as a discrete, first-position section.
3. **Structural per-project isolation** — sessions/memory stay under `~/.blazecoder/projects/<key>/`; new settings/skills/agents/output-styles travel **with the repo** under `<cwd>/.blazecoder/` (committable) and `settings.local.json` (gitignored), with a global `~/.blazecoder/` user scope. `buildRuntime` remains the single composition root that decides every root path.

**The single highest-leverage finding, corroborated by 4 of 7 reports independently, is a live correctness bug**: the system prompt and the dead `DEFAULT_AGENTS.explorer.tools` instruct the model to call `read_file / write_file / edit_file / grep / glob / list_files / delete_file / run_command`, but the registry only registers `Read / Write / Edit / Glob / Grep / Bash / memory` — and `list_files`/`delete_file` do not exist at all. Every turn, the model is told to call tools that fail name resolution. This is P0-task-1 and the spine of the P0 prompt/tools work.

### Where the research conflicted, and the decisions taken

- **Prompt shape: single string vs `string[]` sections.** The reference uses a `string[]` with a 1P-only cache-boundary sentinel. blazecoder runs against DeepSeek (3P), which never sees that sentinel. **Decision:** adopt the sectioned composable builder (`PromptContext → string[]`) for gating/layering/testability, but join to one string at the gateway boundary (DeepSeek takes one system string). Drop the cache-boundary sentinel entirely (no 1P cache scope to protect) — keep only the *practical* cache discipline: a stable static prefix, with volatile env/model kept in the per-turn synthetic user message (already blazecoder's pattern, which matches the reference's system-reminder pattern). This reconciles the Prompt report (sectioning) with blazecoder's gateway reality.
- **Token estimation.** Context and Harness reports both touch token budgeting (dedup): the *authoritative* number is the real `usage.inputTokens` blazecoder already captures at `agentLoop.ts:178` but throws away. **Decision:** real-usage-first, type-aware heuristic (chars/2 for JSON-dense tool results, ×4/3 pad) only as the pre-first-call fallback. One implementation in `sessionContext.ts`, consumed by both `maybeCompact` and the budget event.
- **Tool-result clearing.** Reference clears a *whitelist* and floors keep-recent at ≥1; blazecoder nukes every non-recent tool message. **Decision:** whitelist (`Read/Bash/Grep/Glob`), keep Edit/Write confirmations, tool-aware marker, never clear the most recent.
- **Permission persistence scope.** Reference defaults "always allow" to project-local-gitignored. **Decision:** mirror it — default suggestion destination = `local` (`<cwd>/.blazecoder/settings.local.json`); `project` is committable; `user` is global (`~/.blazecoder/settings.json`). Crucially settings live in the **working dir**, NOT in `projectStateDir` (which stays for sessions/memory) — settings must travel with the repo. This is the concrete global-vs-project decision the brief asked for.
- **Subagent isolation: worktree vs shared workspace.** Reference offers worktree isolation; blazecoder's `runSubagent` shares the parent workspace with an isolated ledger. **Decision:** keep shared-workspace + isolated-ledger for v1 (simpler, already tested); worktree is out of scope. Sub-agents cannot nest (enforce a depth flag in `ToolContext`).
- **Streaming-time tool execution.** Reference executes tools mid-stream; blazecoder executes after the stream resolves. **Decision:** keep post-stream execution (simpler, correct, no withhold/recover machinery needed). Do NOT port `StreamingToolExecutor` — its complexity isn't justified for a single-provider CLI. We DO port the orphaned-tool_result-on-abort backfill (a latent correctness bug).
- **MCP.** Largest surface, lowest near-term ROI for a single-DeepSeek CLI. **Decision:** P2, design-only — define a `ToolSource` seam so MCP tools later register as `mcp__server__tool` alongside built-ins with zero loop/engine changes.

### Dedup map (capabilities that appeared in multiple reports)

- **Token budgeting** → Context (estimation) + Harness (budget caps). Consolidated into P0-context-1 (estimation) + the existing inline caps; no duplicate budget module.
- **Tool-name mismatch** → Prompts + Tools + Orchestration all flagged it. One P0 fix (P0-tools-1) routes all names through a shared constant and adds a regression test; the prompt rewrite (P0-prompts-2) and agent-registry fix (P1-orch-1) consume it.
- **Permission rule grammar** → Permissions + Extensibility both want `Bash(git:*)` / `Read(src/**)`. One grammar (P0-perm-1) reused by hook `if` conditions and plan-mode `allowedPrompts`.
- **Stop hook / lifecycle hooks** → Harness (Stop can block) + Extensibility (4 dead lifecycle seams). Wiring the dead seams (P0-ext-1) is the prerequisite; the blocking-Stop behavior (P1-harness-3) builds on it.
- **runSubagent → Task tool** → Tools + Orchestration. One task (P0-orch-2).

---

## Dimension 1 — Prompt System

### Chosen design
Replace the single 36-line static string with a **sectioned composable builder** in `agent-core/src/prompts.ts` that returns `string[]`, joined to one system string at the gateway boundary. The builder takes a `PromptContext` so guidance can be gated on the actually-enabled tools and layered with mode/effort.

```ts
interface PromptContext {
  toolNames: Set<string>;     // from registry.names() — gates the using-tools section
  model?: string;             // for the env/model line (kept in the per-turn user msg, not here)
  effort?: Effort;            // drives a verbosity section
  modePrompt?: string;        // optional mode persona slot
  override?: string;          // replaces everything (custom --system-prompt)
  extra?: string;             // appended as "## Additional instructions"
}
function buildSystemPrompt(ctx: PromptContext): string[]
```

Sections, in order (each a factory returning `string | null`, nulls filtered):
1. **identitySection** (FIRST, unchanged in spirit) — verbatim blazecoder identity from current prompts.ts:17-20: "You are blazecoder… Do not claim to be Claude, ChatGPT, DeepSeek, Gemini… You are blazecoder." This is the swappable identity slot the reference keeps separate; blazecoder's is already correct and must be preserved.
2. **systemRulesSection** — loop discipline (gather→act→verify), denial handling, prompt-injection defense, a compaction note.
3. **doingTasksSection** — port the reference's counterweight prose (scrubbed of brand), verbatim where load-bearing:
   - disambiguation few-shot: *"If asked to change `methodName` to snake_case, do not just reply `method_name` — find the method in the code and modify it."*
   - *"Do not propose changes to code you haven't read."*
   - minimal-complexity: *"Three similar lines beat a premature abstraction."*
   - comment discipline: *"Default to no comments; add one only when the WHY is non-obvious."*
   - **VERIFY counterweight (verbatim):** *"Before reporting a task complete, verify it actually works. If you can't verify, say so explicitly rather than claiming success."*
   - **false-claims (verbatim):** *"Never claim all tests pass when the output shows failures. Do not hedge confirmed results."*
4. **executingActionsSection** — port reversibility/blast-radius prose (verbatim): *"Consider reversibility and blast radius. The cost to confirm is low; an unwanted action can be very costly. Approving `git push` once does not mean approval in all contexts."* Risky categories: `rm -rf`, force-push, `git reset --hard`, amending published commits, pushing code. *"Do not bypass safety checks like `--no-verify`. Resolve merge conflicts rather than discarding work."*
5. **usingToolsSection(toolNames)** — gated on the registry name set; references tools through the shared `TOOL_NAMES` constant (see P0-tools-1). Verbatim steer (scrubbed): *"Prefer Read over `cat`/`head`/`tail`, Edit over `sed`/`awk`, Glob over `find`, Grep over `grep`/`rg`. Reserve Bash for installs, builds, tests, and git."*
6. **communicationStyleSection** — port verbatim (scrubbed): *"Write for a person, not a console. Don't narrate internal machinery — don't say 'let me call Grep.' Use flowing prose; avoid over-formatting; each bullet should be at least 1-2 sentences. State edits in one sentence. Do not append 'Is there anything else?'. Ask at most one question per response. Use emojis only if the user requests them. Reference code as `file_path:line_number`. No colon immediately before a tool call."*
7. **verbositySection(effort)** — low = concise; ultra = thorough.
8. **modePrompt** slot (if present).
9. **"## Additional instructions"** (if `extra`).

Add **`buildSubagentPrompt(ctx)`** for `runSubagent`: concise-report contract + the absolute-paths Notes footer (verbatim, scrubbed): *"Agent threads reset cwd between bash calls — use absolute file paths. Share absolute paths in your report. Include code snippets only when load-bearing. Avoid emojis. Respond with a concise report; complete the task fully but don't gold-plate."*

`loopConfig.system` changes from `string` to `string[]`, built lazily per-run from `registry.names()`, joined at the gateway adapter. Add a **by-name audit test** (mirrors the reference's `promptEngineeringAudit`): assert ~12 named anchors survive rendering AND that every tool name mentioned in the rendered prompt exists in the registry.

### Why
The single static string cannot gate guidance on enabled tools, layer mode/effort, or keep a stable cacheable prefix while env/model varies. The 36-line prompt is missing every high-value counterweight (verify-before-done, no-false-claims, reversibility, communication discipline) the reference proved matter. Sectioning is the precondition for the mode/skill/output-style layering in later dimensions. Identity stays a discrete first section so it can never be diluted.

---

## Dimension 2 — Tools

### Chosen design
- **`toolNames.ts` (new)** — `export const TOOL_NAMES = { read:'Read', write:'Write', edit:'Edit', glob:'Glob', grep:'Grep', bash:'Bash', memory:'memory', todo:'TodoWrite', task:'Task' } as const;` Every tool's `name` field and every prompt reference go through this. Kills the drift bug at the source.
- **Upgrade tool descriptions to reference-grade** (fold the reference's long `prompt()` into blazecoder's single `description` channel, ≤25 lines each), porting verbatim:
  - **Read:** absolute-path requirement, 2000-line default, offset/limit, `cat -n` format, "can only read files not directories — use Bash ls", empty-file system-reminder.
  - **Edit:** *"When editing text from Read output, preserve exact indentation as it appears AFTER the line-number prefix (format: padded line number + tab); never include any part of the prefix in old_string/new_string. The edit FAILS if old_string is not unique — add surrounding context or use replace_all."*
  - **Bash:** the dedicated-tool steer (*"File search: use Glob NOT find/ls; Content search: use Grep NOT grep/rg; Read files: use Read NOT cat/head/tail; Edit files: use Edit NOT sed/awk"*) + parallel/sequential rules (*"independent → multiple Bash calls in one message; dependent → single call with &&; ';' only when you don't care if earlier fails; never use newlines to separate commands"*) + the `description` param worked-examples block.
  - **Glob:** *"IMPORTANT: omit `path` to use the workspace root; DO NOT pass 'undefined' or 'null'. For open-ended multi-round searches, use the Task tool."*
  - **Grep:** regex-escaping note + *"ALWAYS use Grep; NEVER invoke grep/rg via Bash."*
- **TodoWrite tool (new)** — name `TodoWrite`, `readOnly:false` (auto-allowed by the engine). Schema `{ todos: { content: string≥1, status: 'pending'|'in_progress'|'completed', activeForm: string≥1 }[] }`. Port the reference description verbatim + a condensed long-prompt (7 when-to-use triggers, 4 when-NOT, the single-`in_progress` rule, the "never mark completed if tests failing/partial" rule, ONE worked example). State held per-session; full-array replace; clear when all completed; emit a `todos` event for the TUI. **Verification nudge:** when `allDone && todos.length≥3 && none match /verif|test|build/i`, append to the result a reminder to run build/tests — this reinforces blazecoder's verify-before-done culture.
- **Per-tool `maxResultSizeChars` (P2)** — add the optional field; on overflow spill full output to `<session-dir>/tool-results/<id>.txt` and give the model a preview + path. Bash=30k (preserve stderr tail — the failure signal), file/search=100k. Replaces the flat 60k executor cap.
- **searchHint + CORE_TOOLS allowlist (P2, design-only)** — add optional fields now so deferred-tool loading can be switched on later (esp. if MCP lands) without reworking the `Tool` contract.

### Why
blazecoder's descriptions are ~10× shorter than reference-grade and miss guidance learned the hard way. TodoWrite is the single highest-leverage missing tool — it makes multi-step work legible and keeps the model on-track; the reference invests ~180 prompt lines precisely because it changes behavior.

---

## Dimension 3 — Permissions

### Chosen design
- **Rule grammar (`rule.ts`, new):**
  ```ts
  type RuleBehavior = 'allow'|'deny'|'ask';
  type RuleSource = 'user'|'project'|'local'|'cliArg'|'session';
  type PermissionRule = { source: RuleSource; behavior: RuleBehavior; value: { toolName: string; ruleContent?: string } };
  ```
  Parser `ruleFromString('Bash(git commit:*)')` using first-unescaped-`(` / last-unescaped-`)`; `Tool()`/`Tool(*)` collapse to tool-wide. Per-tool matchers:
  - **Bash** (`bashRuleMatch.ts`): exact | `prefix:*` | `glob*`. Normalize command first (strip output redirections, strip a small SAFE_ENV_VARS allowlist + wrappers like `timeout`/`nice`); **REFUSE prefix/wildcard match on compound commands** (`splitCommand(cmd).length>1`) so `Bash(cd:*)` can't match `cd x && evil`; enforce word boundary (`ls:*` matches `ls`/`ls ` not `lsof`).
  - **Read/Write/Edit** (`pathRuleMatch.ts`): gitignore-style glob via a tiny matcher or `picomatch`, rooted by rule source dir (`//abs`, `~/`, `/source-rel`, bare=anywhere).
  - default (no content): whole-tool match on `tool.name`.
- **Rewrite `PermissionEngine` to behavior-priority over layered rules** — hold `Map<RuleSource, PermissionRule[]>` instead of two Sets. Gate order (mirrors the reference): hooks → protected-paths → **matchDeny (all sources)** → path/sandbox constraints → matchAllow → matchAsk → mode disposition → readOnly auto-allow → ask(broker). `PermissionDecision` gains an explicit `ask` arm and a `decisionReason` (tagged union: `rule|mode|hook|protected|other`) so the TUI can explain *why* and hint `/permissions`.
- **Persisted settings pipeline (`settingsStore.ts` + `update.ts`):** file shape `{ permissions: { allow:string[], deny:string[], ask:string[], defaultMode? } }`. Layout:
  - user (global): `~/.blazecoder/settings.json`
  - project (committable): `<cwd>/.blazecoder/settings.json`
  - local (gitignored): `<cwd>/.blazecoder/settings.local.json`
  `PermissionUpdate = addRules|removeRules|setMode` with `destination`. `applyUpdate` mutates in-memory; `persistUpdate` writes only to user/project/local (dedup via parse→serialize roundtrip). Load order user→project→local→session into the Map. Wired in `buildRuntime` (the single composition root). **Settings live in the working dir, NOT projectStateDir.**
- **"Always allow" suggestions (P1):** on `ask`, attach `suggestions: PermissionUpdate[]` — Bash → stable 2-word prefix (`git commit -m x` → `Bash(git commit:*)`), blocked for bare dangerous prefixes (bash/sh/sudo/env/eval/python); file tools → dir glob. TUI offers `[y] once · [a] always (local) · [A] always (project) · [n] no`; on always, apply+persist and re-evaluate so the in-flight call proceeds.
- **Denial-loop protection (P2):** port `denialTracking.ts` (maxConsecutive 3, maxTotal 20); on repeated deny, inject a corrective user message and reset.

### Why
Plain tool-name Sets cannot express "git status but not git push" or "edit src/** but not .env" — the single most load-bearing capability gap. Everything (persistence, suggestions, plan-mode `allowedPrompts`, hook `if` conditions) reuses this one grammar.

---

## Dimension 4 — Context Management / Compaction

### Chosen design
- **Type-aware estimation + real-usage-first (`sessionContext.ts`):** add `lastRealInputTokens?` to `SessionState`, set in `agentLoop` from `response.usage.inputTokens`. `maybeCompact` uses `current = session.lastRealInputTokens ?? estimateRequestTokens(...)`. Estimator uses chars/2 for tool-result content (JSON-dense), pads the total ×4/3. Budget math in absolute offsets from an effective window: `effective = contextTokens − min(maxOutputTokens+15000, 20000)`; `threshold = effective − bufferTokens(13000)`.
- **Whitelist tool-result clearing (`compaction.ts`):** `COMPACTABLE = {Read,Bash,Grep,Glob}`; never clear Edit/Write confirmations, never clear the most recent (floor 1), skip already-cleared. Tool-aware marker `[<TOOL> result cleared to save context]`. Track `clearedToolUseIds` and emit on the boundary event.
- **Post-compact file rehydration (`rehydration.ts` + ledger):** expose the ledger's recently-read paths by recency. After summarizing, re-read up to 5 files fresh through the Read tool (~5k tokens/file, 50k total), skip files still present verbatim in the kept tail, insert as a `{role:'user', content:'[Restored file context after compaction] …'}` right after the summary, and clear ledger stamps so the next Edit re-validates.
- **Compaction boundary + tool-pair preservation (P1):** port `adjustIndexToPreserveAPIInvariants` — walk back from the split to pull in the assistant `tool_use` message(s) any kept `tool_result` references (DeepSeek rejects orphaned results). Replace the fixed keep-count with a token-floored window (expand back until ≥minTokens AND ≥minTextMsgs, cap maxTokens). Add a boundary marker to the summary message.
- **Failure circuit breaker + PTL escape hatch (P1):** add `consecutiveFailures` (cap 3); wrap `summarize` in try/catch (surface a notice, don't throw out of the loop); add `truncateHeadForSummary` (group by API round, drop oldest, keep ≥1, cap 3 retries) for when the summarize call itself overflows.
- **Harden the summary prompt (P1, `rehydration.ts`):** prepend *"CRITICAL: Respond with TEXT ONLY. Do NOT call any tools — you already have all needed context; tool calls will be rejected."*; add a stripped `<analysis>` scratchpad (post-process with `/<analysis>[\s\S]*?<\/analysis>/`); add "All user messages" and a verbatim-quoted "Next step" section; append *"Resume directly; do not acknowledge this summary."*
- **Cache discipline (P2):** keep the stable prefix byte-identical across turns; surface DeepSeek cache token fields (if any) in the budget event; log `compaction_done` with before/after.
- **Live session-notes as zero-cost summary (P2):** optional NOTES.md (Current State / Files / Errors / Pending) used verbatim (head-truncated) instead of calling the summarizer when present.

### Why
The whole budget rests on token accounting; flat chars/4 over-counts tool-result JSON ~2× (premature compaction) and ignores the real server count already received. Blanket clearing destroys cheap-but-useful Edit/Write confirmations. After summarizing, the model has only prose file mentions — fresh re-reads start post-compact turns on validated content.

---

## Dimension 5 — Harness / Agent Loop

### Chosen design
- **Model-call retry/backoff/fallback in the gateway adapter (P0):** wrap `complete`/`stream` in `withRetry` inside `deepseekGateway` — BASE_DELAY 500ms, exp backoff (cap ~30s), jitter, honor Retry-After; retry on 429/500/502/503/529 + network errors (ECONNRESET/ETIMEDOUT); never retry 4xx auth/validation; abort-aware. Add a 90s SSE idle-timeout watchdog. Emit an `api_retry` event (new in shared/events.ts) so the TUI shows live attempts. **Stays in the adapter — the loop stays dumb.**
- **Typed transition/Terminal state machine (`transitions.ts`, P0):** `Terminal = {completed|model_error|aborted|max_turns|max_budget|compaction_thrash|context_overflow}`; `Continue = {next_turn|output_truncation_recovery|reactive_compact_retry|stop_hook_blocking}`. Refactor the loop's locals into one immutable `LoopState` rebuilt at each continue point, carrying `transition` (the breadcrumb) so recovery paths gate on the previous transition to prevent spirals. Derive `ResultSubtype` from `Terminal` at the single finish site — external contract unchanged.
- **Between-turns steering queue (`SteeringQueue` port, P1):** `interface SteeringQueue { drain(): string[] }`, optional in `AgentLoopDeps` (default no-op). After `executeTurn`, before next iteration, push drained user text as `{role:'user'}` messages. TUI routes Enter-while-running to the queue. Trivial fake for tests.
- **Stop hook can block completion (P1):** at the no-tool-calls completion point, run `hookBus.runStop`; `preventContinuation` → terminal; `blockingErrors` → push as user messages, set transition `stop_hook_blocking`, continue. **Guard (verbatim intent):** skip Stop hooks when the last turn is an API error (avoids the documented death spiral). Builds on P0-ext-1 (wiring the dead Stop seam).
- **Output-truncation recovery (P1):** on `stopReason==='max_tokens'` with no tool calls — first occurrence escalate `maxOutputTokens` and retry silently; subsequent inject *"Output token limit hit. Resume directly — no apology, no recap."*; cap 3 (`state.recoveryCount`).
- **Synthetic tool_result on abort (P2):** on abort/model_error after an assistant turn with tool calls, synthesize one `{ok:false, output:'[Interrupted]', isError:true}` per orphaned `toolCall.id` so resumed/multi-turn conversations stay API-valid.
- **Reactive compaction on overflow (P2):** adapter throws typed `ContextOverflowError`; loop catch compacts-and-retries once (`hasReactiveCompacted` guard, transition `reactive_compact_retry`), shares the thrash counter.

### Why
The single highest-value gap: today any transient DeepSeek error kills the whole run. The transitions machine is the structural prerequisite for every recovery path and makes them unit-testable by asserting the transition. We deliberately do NOT port the two-layer QueryEngine split or streaming-time execution — too much complexity for a single-provider CLI; the immutable-state refactor delivers most of the benefit.

---

## Dimension 6 — Sub-agents & Orchestration

### Chosen design
- **Fix the stale names in `agentRegistry.ts` (P0):** `explorer.tools` → `['Read','Grep','Glob']`; add a test that every name in every `AgentDefinition.tools` exists in `registry.names()`. (Consumes P0-tools-1.)
- **Wire `runSubagent` as a model-callable `Task` tool (P0):** add `ToolContext.spawn(def, prompt, signal)` injected by the runtime. `makeTaskTool(registry)`: name `Task` (alias `Agent`), schema `{ description: string(3-5 words), subagent_type?: enum, prompt: string }`. `execute` looks up the def, errors if missing or `spawn` absent (no-nest at depth>0), else returns the sub-agent's distilled text. Description ports the "Writing the prompt" guidance verbatim (scrubbed): *"Brief the sub-agent like a smart colleague who just walked in — it has NOT seen this conversation. Explain what to accomplish and why; hand over exact paths/commands for lookups, the question for investigations. Never delegate understanding. The result is not visible to the user — summarize it back. Sub-agents cannot nest."* Synchronous, run-to-completion for v1.
- **Per-agent tool-pool filtering + subagent event (P1):** `ToolRegistry.filter(names, deny)` (always excludes Task); spawn builds a filtered registry + sub-executor. Add an `AgentEvent` `subagent` arm (phase start/end, agentType, description, turns/subtype/summary); inner events suppressed for v1.
- **`.claude/agents` → `.blazecoder/agents` markdown loader (P1):** `loadAgentDefinitions(home, cwd)` parses frontmatter (name, description, body=systemPrompt, optional tools/maxTurns), skips no-name files, collects errors into `failedFiles`, merges DEFAULT_AGENTS→user→project (later wins), validates tools against registry names, composes the prompt via `buildSystemPrompt`/`buildSubagentPrompt`. Behind the same trust gate as settings hooks.

### Why
The hard part (fresh context, shared workspace, isolated ledger, no-nest) already exists in `subagent.ts`; only the tool wrapper and a registry route are missing. Delegation lets the main agent fan out exploration without polluting its own context.

---

## Dimension 7 — Extensibility

### Chosen design
- **Wire the 4 dead HookBus lifecycle events (P0):** `PreCompact/SessionStart/SessionEnd/Stop` are declared but never fired. Pass the HookBus into the loop (or fire from `index.ts.run`): `runSessionStart` before the loop (with an `additionalContext` path that pushes returned strings as a synthetic user message), `runPreCompact` just before `maybeCompact` actually compacts, `runStop`/`runSessionEnd` in a finally. Best-effort (try/catch → notice). This is the cheapest fidelity fix and the prerequisite for blocking-Stop (P1-harness-3) and settings-driven hooks.
- **Markdown SKILL loader + model-callable `skill` tool (P1):** `interface Skill { name; description; whenToUse?; allowedTools?; model?; effort?; context:'inline'|'fork'; body; dir }`. `loadSkills(home, cwd)` scans `~/.blazecoder/skills/<name>/SKILL.md` and `<cwd>/.blazecoder/skills/<name>/SKILL.md`, parses YAML frontmatter, dedupes by realpath, project>user. Surfaced twice: (1) merged into the TUI COMMANDS list so `/skill-name` works (inline expands body into the next prompt, substituting `$ARGUMENTS`, `${SKILL_DIR}`); (2) a `skill` Tool — `context:'fork'` calls `runSubagent(body+args, deps filtered to allowedTools)`, `inline` returns the body as the tool result. Behind the trust gate.
- **settings.json hooks reader + command-hook executor (P1):** `settings.ts` reads `~/.blazecoder/settings.json` + `<cwd>/.blazecoder/settings.json`, Zod-validates `{ hooks?: { PreToolUse?, PostToolUse? }, allow?, deny? }`. `commandHook.ts` factory spawns a shell with the event payload as JSON on stdin, parses JSON stdout → decision (exit 2 / `{decision:'block'}` → deny; `{updatedInput}` → allow; else continue). Port the reference matcher grammar (`*` / pipe / regex). **MUST ship behind a workspace-trust gate** (prompt once, persist under projectStateDir; home scope implicitly trusted) — a malicious repo's settings.json running shell on open is an RCE. `BLAZECODER_DISABLE_HOOKS` escape hatch. blazecoder's `PreToolUseDecision` already matches the reference's JSON output exactly.
- **Plan-mode `allowedPrompts` (P1, with permissions):** runtime field `{ tool:'Bash'; prompt:string }[]` that, on plan exit, appends synthesized allow-rules (substring/prefix match is enough). Reuses the P0 rule grammar.
- **Markdown output-style loader (P2):** `loadOutputStyles(home, cwd)` scans `*.md`; each → `{ name, description, prompt: body, keepCodingInstructions? }`. Feeds `buildSystemPrompt`'s `extra` (or `override` when `keepCodingInstructions:false`). `/output-style <name>` command.
- **MCP as a `ToolSource` port (P2, design-only):** `interface ToolSource { tools(): Promise<Tool[]> }`; future `McpToolSource` adapts each server tool to the `Tool` interface (name `mcp__${server}__${tool}`). `buildRuntime` concatenates `builtinTools()` with each source before `registerAll` — no loop/engine changes (the rule grammar already matches `mcp__server:*`). Verify the 64-char `TOOL_NAME_RE` cap fits real names.

### Why
The reference's central idea is that everything a user could add is a file under `.claude/`, loaded and merged at startup — not a code change. blazecoder already has the spine (HookBus, PermissionEngine, AgentRegistry, runSubagent, `buildSystemPrompt(extra)`); it lacks the file-driven outer layer. Skills are the highest-value, lowest-complexity seam (prompts + an allowed-tools modifier).

---

## Rollout plan (prioritized)

**P0 — highest-leverage parity (do first, in order).** P0-tools-1 (name constant + bug fix + regression test) unblocks the prompt rewrite and the agent-registry fix. Then the prompt sectioning (P0-prompts-2), token estimation (P0-context-1), whitelist clearing + rehydration (P0-context-2), permission grammar + engine + persistence (P0-perm-1/2/3), gateway retry (P0-harness-1), transitions machine (P0-harness-2), TodoWrite (P0-tools-2), Task tool (P0-orch-2), and wiring dead hooks (P0-ext-1). These compound: the prompt, tools, permissions, and harness become reference-grade; the model stops mis-calling tools; transient errors stop killing runs; multi-step work becomes legible and delegable.

**P1 — strong additions.** Compaction boundary/tool-pair (P1-context-3), failure breaker + PTL (P1-context-4), summary-prompt hardening (P1-context-5), suggestions (P1-perm-4), steering queue (P1-harness-3a), blocking Stop (P1-harness-3b), output-truncation recovery (P1-harness-4), agent tool-filtering + event (P1-orch-3), agents loader (P1-orch-4), skills loader + tool (P1-ext-2), settings hooks reader (P1-ext-3), plan-mode allowedPrompts (P1-ext-4), upgraded tool descriptions (P1-tools-3), WebSearch/WebFetch (P1-tools-4).

**P2 — nice-to-have.** Per-tool result budget (P2-tools-5), searchHint/CORE_TOOLS (P2-tools-6), cache discipline (P2-context-6), session-notes (P2-context-7), denial-loop protection (P2-perm-5), synthetic tool_result on abort (P2-harness-5), reactive compaction (P2-harness-6), config/deps/state split (P2-harness-7), output-style loader (P2-ext-5), MCP ToolSource design (P2-ext-6).

Every task is independently commit-able with its own unit + integration tests, preserving the 152-green baseline and the in-memory-fakes test discipline. No backward-compat shims — legacy is retired in place (single-string prompt, flat estimator, Set-based allow/deny all replaced outright).