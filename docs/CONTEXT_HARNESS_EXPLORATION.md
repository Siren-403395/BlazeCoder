# Context & Harness — optimization exploration (next-round backlog)

**Status:** research only — nothing here is implemented. Captured for a future round.
**Method:** an adversarial multi-agent sweep (5 subsystem explorers × a per-candidate skeptic
that verified each claim against the source). 25 candidates generated → **24 rejected, 1 "maybe".**
**Headline:** the context/harness subsystem is **mature**. The single most useful result of this
sweep is *negative*: almost every "optimization" died because its stated problem **did not survive
reading the code** — the thing was already solved, or the premise was factually wrong. Treat the
rejection list below as a "do-not-re-propose, here's why" guard for the next round.

> Scope note: ideas already shipped (per-block `/context`, the `compactable` compaction flag, the
> Bash command-risk + catastrophic tripwire) and the work done this session (uncapped turns/budget,
> the `auto` permission mode + Shift+Tab, effort-in-border, the git-backed `/changes` honesty layer)
> were excluded from the sweep by design.

---

## 1. The one survivor — worth a *small*, gated experiment

### Sub-agent memory inheritance (opt-in) — priority: LOW
- **Idea:** a delegated sub-agent (Task tool) runs in a fresh context and does **not** receive the
  parent's passively-recalled memory index. For a purpose-built agent that genuinely benefits from
  durable project facts, let it request inheritance.
- **Why it's only a "maybe", not a "yes":** clean sub-agent isolation is a **deliberate, documented
  design choice** (`index.ts` "sub-agents get a fresh context"; `subagent.ts` calls fresh context
  "the strongest context lever"; the sub-agent prompt says "you have NOT seen the parent
  conversation"). Blanket inheritance would reverse that and dilute a focused brief with the
  parent's session-log-flavored memory — usually noise for a "grep X and report" agent. The built-in
  `explorer` has no memory tool at all, so it can't even use it.
- **The honest, minimal form** (NOT the candidate's proposed new config field — the plumbing already
  exists): add an opt-in `inheritMemory?: boolean` (default **false**) to `AgentDefinition`; in
  `AgentRuntime.spawn`, when true, `loadMemoryIndex(this.memory)` and set the **existing**
  `config.memorySection` (one line). Defaults stay clean-isolated.
- **Gate:** do not ship until a test proves a measurable reduction in redundant discovery for at
  least one concrete agent. Otherwise it's complexity fighting a load-bearing decision.

---

## 2. Rejected — verified already-solved or false premise (do not re-propose)

Each was generated as a plausible optimization, then **refuted by reading the code**. Recorded so the
next exploration round doesn't burn cycles re-deriving them.

| Candidate | Why it was rejected (verified) |
|---|---|
| **Tokenizer provider abstraction** (swap the char-heuristic for a real tokenizer) | The heuristic is a **one-turn bootstrap fallback**, not the steady-state driver — `session.lastRealInputTokens` (the server's authoritative count) already drives the compaction gates after turn 1. DeepSeek is OpenAI-compatible with **no public client tokenizer**, so the "real tokenizer adapter" is fictional. Optimizes a path that fires ~once/session. |
| **Compaction tier / stage tracking** ("no data on which stage was the bottleneck") | False: `compaction.ts` already emits structured `logger.info("compaction_done", { stage, tokensBefore, tokensAfter, cleared, summarized })` at every stage + a gate-trace `debug`. The data already exists. |
| **Per-tool rich error typing** ("loop is blind to deny vs error") | False: `ToolResultRecord.denied` already exists and the loop already acts on it via `DenialTracker`. The proposed `timeout/internal/invalid_input` types would have **zero consumers**. `regenerable` is already modeled by the `compactable` flag. |
| **Multi-session TUI state isolation** ("effort/outputStyle leak across `/resume`") | False **and a regression**: effort/outputStyle are process/runtime-level by design (not on `SessionState`); the proposed reset-to-`initialState` would *discard* a mid-session `/effort`. |
| **Prompt-cache stability lease**, **request-assembly estimate memoization**, **lazy tool-result projection**, **denial metadata in LoopState**, **execution-strategy abstraction**, **tool-registry metadata index**, **lazy skill loading**, **session checksum/corruption recovery**, **cross-ledger sub-agent recall**, **sub-agent output-style inheritance**, …(rest of the 24) | All rejected on the same pattern: the load-bearing claim contradicted the actual code (already cached, already structured, already isolated, already cheap at real session sizes of 1–5 KB, or duplicating an existing mechanism). Full reasoning in the workflow transcript. |

---

## 3. Adjacent signal already being acted on

- **Truncated-diff honesty.** `computeFileDiff` caps at `maxLines:200` and sets `truncated:true`; the
  TUI's display cap (`MAX_DIFF_LINES`) further trims. A capped diff can silently under-report. This
  is being addressed by the **git-backed `/changes`** work (see the rollback decision) rather than by
  making the in-app diff lossless — git already holds the full, durable truth.

---

## 4. Takeaway for the next round

The cheap wins in this subsystem are largely spent. Future effort is better aimed at **new
capabilities** (e.g. the mode system's `plan` slot, richer steering) than at micro-optimizing
context/compaction, which adversarial review shows is already tight. When a future idea sounds good,
**verify its premise against the code first** — that single step killed 24/25 here.

*Generated from workflow `explore-context-harness-opt` (run `wf_d7b7556c-cf6`); full per-candidate
verdicts in that transcript.*
