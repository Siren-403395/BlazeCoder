/**
 * agent-core public API + the AgentRuntime factory that wires every part together
 * behind injected ports. The CLI constructs one AgentRuntime and feeds its event
 * stream straight to the TUI in-process; tests construct one with in-memory fakes.
 */

import { relative } from "node:path";
import { isSecretPath, looksLikeSecret } from "@blazecoder/shared";
import type {
  Clock,
  EventSink,
  Logger,
  MemoryStore,
  ModelGateway,
  Sandbox,
  SessionState,
  SessionStore,
  SessionSummary,
  SteeringQueue,
  Workspace,
} from "./ports";
import { builtinTools } from "./tools/builtin";
import { makeTaskTool } from "./tools/builtin/task";
import type { Tool } from "./tools/registry";
import { ToolRegistry } from "./tools/registry";
import { ToolExecutor } from "./tools/executor";
import { AgentRegistry } from "./orchestration/agentRegistry";
import type { AgentDefinition } from "./orchestration/agentRegistry";
import { runSubagent } from "./orchestration/subagent";
import type { SubagentRunResult } from "./orchestration/subagent";
import type { Skill } from "./skills/loadSkills";
import { outputStyleOptions } from "./outputStyles";
import type { OutputStyle } from "./outputStyles";
import { HookBus } from "./permissions/hooks";
import type { PostToolUseHook, PreToolUseHook } from "./permissions/hooks";
import { PermissionBroker, PermissionEngine } from "./permissions/engine";
import type { BrokerDecision, PermissionMode } from "./permissions/engine";
import type { PermissionRule, RuleSource } from "@blazecoder/shared";
import { ruleValueFromString } from "./permissions/rule";
import { persistPermissionUpdate, supportsPersistence } from "./permissions/update";
import type { PermissionUpdate } from "./permissions/update";
import { ContextManager, DEFAULT_COMPACTION } from "./context/compaction";
import type { CompactionConfig, ManualCompactResult } from "./context/compaction";
import { computeBudget, computeContextBreakdown } from "./context/sessionContext";
import type { ContextReport } from "@blazecoder/shared";
import { buildLoopConfig } from "./loop/config";
import { loadMemoryIndex } from "./memory/autoMemory";
import { MODEL_MAX_OUTPUT_TOKENS } from "./effort";
import type { Effort } from "./effort";
import { FileSystemWorkspace } from "./workspace/fsWorkspace";
import { ReadLedger } from "./workspace/ledger";
import { runAgentLoop } from "./loop/agentLoop";
import type { AgentLoopConfig, AgentLoopDeps, AgentRunResult } from "./loop/agentLoop";
import { silentLogger, systemClock } from "./util";

// ─── Re-exports (public API surface) ──────────────────────────────────────────
export * from "./ports";
export * from "./tools/registry";
export * from "./tools/executor";
export * from "./tools/builtin";
export * from "./tools/coreTools";
export * from "./permissions/hooks";
export * from "./permissions/engine";
export * from "./permissions/protectedPaths";
export * from "./permissions/rule";
export * from "./permissions/denialTracking";
export * from "./permissions/bashRuleMatch";
export * from "./permissions/commandRisk";
export * from "./permissions/pathRuleMatch";
export * from "./permissions/settingsStore";
export * from "./permissions/update";
export * from "./permissions/suggestions";
export * from "./context/sessionContext";
export * from "./context/compaction";
export * from "./context/rehydration";
export * from "./diff";
export * from "./effort";
export * from "./memory/memoryStore";
export * from "./memory/memoryTool";
export * from "./memory/projectRules";
export * from "./memory/autoMemory";
export * from "./session/store";
export * from "./workspace";
export * from "./util";
export * from "./prompts";
export * from "./outputStyles";
export * from "./loop/agentLoop";
export * from "./loop/transitions";
export * from "./loop/config";
export * from "./orchestration/agentRegistry";
export * from "./orchestration/loadAgents";
export * from "./orchestration/subagent";
export * from "./skills/loadSkills";
export * from "./skills/skillTool";

// ─── Runtime factory ──────────────────────────────────────────────────────────

export interface AgentRuntimeOptions {
  gateway: ModelGateway;
  sessionStore: SessionStore;
  memory: MemoryStore;
  sandbox?: Sandbox;
  /** The working directory the agent edits (defaults to process.cwd()). */
  cwd?: string;
  /** Extra writable roots beyond cwd (e.g. --add-dir). */
  writableRoots?: string[];
  /** Inject a Workspace directly (tests use InMemoryWorkspace); overrides cwd. */
  workspace?: Workspace;
  clock?: Clock;
  logger?: Logger;
  idGen?: () => string;
  tools?: Tool[];
  /** Extra tools appended to the built-ins (e.g. a Skill tool, web tools). */
  extraTools?: Tool[];
  /** Loaded skills (exposed via runtime.skills for the /skill palette). */
  skills?: Skill[];
  /** Output styles available to switch between at runtime (exposed via runtime.outputStyles). */
  outputStyles?: OutputStyle[];
  /** Name of the output style to activate at startup (resolved against outputStyles). */
  outputStyle?: string;
  /** Custom sub-agent definitions (merged over the built-ins) for the Task tool. */
  agents?: AgentDefinition[];
  /** Extra PreToolUse/PostToolUse hooks (e.g. settings-driven command hooks), registered after the built-in secrets guard. */
  extraPreToolUseHooks?: PreToolUseHook[];
  extraPostToolUseHooks?: PostToolUseHook[];
  system?: string;
  /** Extra durable instructions appended as a final system-prompt section (e.g. an output style). */
  extraInstructions?: string;
  userRules?: string;
  permissionMode?: PermissionMode;
  allow?: string[];
  deny?: string[];
  ask?: string[];
  /** Pre-parsed layered permission rules from settings files (user/project/local). */
  rules?: PermissionRule[];
  /** Maps a rule source to the dir its settings file is rooted at (source-relative path globs). */
  sourceRootDir?: (source: RuleSource) => string | undefined;
  /** Settings file paths per persistent scope, so "always allow" can write to disk. */
  settingsFiles?: Record<"user" | "project" | "local", string>;
  /** Directory for spilled oversized tool output (readable via Read if inside the workspace). */
  spillDir?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  contextTokens?: number;
  temperature?: number;
  maxOutputTokens?: number;
  /** Default reasoning effort when a run does not specify one (default "high"). */
  defaultEffort?: Effort;
  compaction?: Partial<CompactionConfig>;
}

export interface RunOptions {
  prompt: string;
  /** Resume an existing session; omit to start a new one. */
  sessionId?: string;
  title?: string;
  /** Reasoning effort for this turn (maps to thinking mode + output budget). */
  effort?: Effort;
  /** Between-turns steering queue (the TUI's mid-run input FIFO). */
  steering?: SteeringQueue;
}

export interface RunOutcome {
  session: SessionState;
  result: AgentRunResult;
}

/** Fallback turn cap for a sub-agent whose definition (and the main loop) set none — keeps an
 *  unattended delegated agent bounded even after the main loop's caps were removed. */
const DEFAULT_SUBAGENT_MAX_TURNS = 50;

const disabledSandbox: Sandbox = {
  available: false,
  async run() {
    return { stdout: "", stderr: "sandbox disabled", exitCode: 1, timedOut: false };
  },
};

function makeIdGen(clock: Clock): () => string {
  let n = 0;
  return () => `id-${clock.now().toString(36)}-${(n++).toString(36)}`;
}

function titleFromPrompt(prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed || "Untitled session";
}

/**
 * Deterministic secrets guard, independent of model output and permission mode:
 * the file tools may never read or write a secret/credential file, and may never
 * write content that looks like an embedded secret.
 */
const secretsHook: PreToolUseHook = ({ toolName, input }) => {
  const isFileTool = toolName === "Read" || toolName === "Write" || toolName === "Edit";
  const filePath = typeof input.file_path === "string" ? input.file_path : undefined;
  if (isFileTool && filePath && isSecretPath(filePath)) {
    return { decision: "deny", message: `Refusing to access a secret/credential file: ${filePath}` };
  }
  if (toolName === "Write" || toolName === "Edit") {
    const candidate =
      typeof input.content === "string"
        ? input.content
        : typeof input.new_string === "string"
          ? input.new_string
          : "";
    if (candidate && looksLikeSecret(candidate)) {
      return { decision: "deny", message: "Refusing to write content that appears to contain a secret." };
    }
  }
  return { decision: "continue" };
};

export class AgentRuntime {
  readonly broker: PermissionBroker;
  readonly hooks: HookBus;
  private readonly engine: PermissionEngine;
  private readonly store: SessionStore;
  private readonly gateway: ModelGateway;
  private readonly memory: MemoryStore;
  private readonly sandbox: Sandbox;
  private readonly workspace: Workspace;
  private readonly ledger: ReadLedger;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly idGen: () => string;
  private readonly registry: ToolRegistry;
  private readonly agentRegistry: AgentRegistry;
  private readonly executor: ToolExecutor;
  private readonly contextManager: ContextManager;
  /** Mutable so setOutputStyle can re-derive the prompt; the next run re-snapshots it. */
  private loopConfig: AgentLoopConfig;
  private readonly defaultEffort: Effort;
  private readonly settingsFiles?: Record<"user" | "project" | "local", string>;
  private readonly spillDir?: string;
  /** Loaded skills (for the /skill palette in the TUI). */
  readonly skills: Skill[];
  /** Output styles available to switch between (for the /output-style palette). */
  readonly outputStyles: OutputStyle[];
  /** The non-style base prompt config, restored when the active style is cleared. */
  private readonly basePromptOverride?: string;
  private readonly baseExtraInstructions?: string;
  /** Name of the currently-active output style, if any. */
  private activeStyle?: string;

  constructor(opts: AgentRuntimeOptions) {
    this.store = opts.sessionStore;
    this.gateway = opts.gateway;
    this.memory = opts.memory;
    this.sandbox = opts.sandbox ?? disabledSandbox;
    this.workspace =
      opts.workspace ?? new FileSystemWorkspace({ root: opts.cwd ?? process.cwd(), writableRoots: opts.writableRoots });
    this.ledger = new ReadLedger();
    this.clock = opts.clock ?? systemClock;
    this.logger = opts.logger ?? silentLogger;
    this.idGen = opts.idGen ?? makeIdGen(this.clock);

    // Sub-agent definitions + the model-callable Task tool that routes to them.
    this.agentRegistry = new AgentRegistry(opts.agents);
    this.registry = new ToolRegistry().registerAll([
      ...(opts.tools ?? builtinTools()),
      ...(opts.extraTools ?? []),
      makeTaskTool(this.agentRegistry),
    ]);
    // secretsHook FIRST (a deny it returns is final), then any settings-driven hooks.
    this.hooks = new HookBus().onPreToolUse(secretsHook);
    for (const h of opts.extraPreToolUseHooks ?? []) this.hooks.onPreToolUse(h);
    for (const h of opts.extraPostToolUseHooks ?? []) this.hooks.onPostToolUse(h);
    this.broker = new PermissionBroker();
    this.engine = new PermissionEngine({
      mode: opts.permissionMode ?? "acceptEdits",
      allow: opts.allow,
      deny: opts.deny,
      ask: opts.ask,
      rules: opts.rules,
      sourceRootDir: opts.sourceRootDir,
      hookBus: this.hooks,
      broker: this.broker,
      idGen: this.idGen,
    });
    this.executor = new ToolExecutor(this.registry, this.engine, this.hooks, this.clock);

    const contextTokens = opts.contextTokens ?? DEFAULT_COMPACTION.contextTokens;
    // Derive the clearable-results set from each tool's `compactable` flag, so a new bulky
    // read-only tool participates without editing the compaction module — and a tool that
    // sets compactable:false is honored (its results are preserved). We always pass the
    // derived set: the COMPACTABLE fallback inside ContextManager is for direct embedders /
    // tests that never set the key, not for the runtime (whose registry always has the
    // built-in compactable tools, so the set is non-empty in practice).
    const compactableTools = new Set(this.registry.list().filter((t) => t.compactable).map((t) => t.name));
    this.contextManager = new ContextManager(
      {
        ...DEFAULT_COMPACTION,
        contextTokens,
        compactableTools,
        ...opts.compaction,
      },
      this.clock,
      this.logger,
      this.gateway,
    );

    this.loopConfig = {
      promptOverride: opts.system,
      extraInstructions: opts.extraInstructions,
      userRules: opts.userRules,
      // No default caps: a coding agent should run until it (or the user) decides it's done.
      // Pass maxTurns/maxBudgetUsd explicitly (or set the AGENT_MAX_* env vars) to opt into a cap.
      maxTurns: opts.maxTurns,
      maxBudgetUsd: opts.maxBudgetUsd,
      contextTokens,
      temperature: opts.temperature ?? 0.2,
      // The output CEILING (default: the model's full max). The loop sizes the actual
      // per-request budget down from here only as far as the window requires.
      maxOutputTokens: opts.maxOutputTokens ?? MODEL_MAX_OUTPUT_TOKENS,
    };
    this.defaultEffort = opts.defaultEffort ?? "high";
    this.settingsFiles = opts.settingsFiles;
    this.spillDir = opts.spillDir;
    this.skills = opts.skills ?? [];

    // Output styles: the runtime owns the active style so it can switch at runtime.
    // Remember the non-style base (opts.system/extraInstructions) so clearing reverts to it.
    this.outputStyles = opts.outputStyles ?? [];
    this.basePromptOverride = opts.system;
    this.baseExtraInstructions = opts.extraInstructions;
    this.setOutputStyle(opts.outputStyle ? this.outputStyles.find((s) => s.name === opts.outputStyle) : undefined);
  }

  /**
   * Switch the active output style. Re-derives the system prompt knobs on loopConfig from
   * the non-style base + the style; takes effect on the NEXT run (buildLoopConfig
   * re-snapshots per run, exactly like /effort). Pass undefined to revert to the base.
   */
  setOutputStyle(style: OutputStyle | undefined): void {
    const o = outputStyleOptions(style);
    this.loopConfig = {
      ...this.loopConfig,
      promptOverride: o.system ?? this.basePromptOverride,
      extraInstructions: o.extraInstructions ?? this.baseExtraInstructions,
    };
    this.activeStyle = style?.name;
  }

  /** The name of the active output style, if any (for display). */
  get outputStyle(): string | undefined {
    return this.activeStyle;
  }

  private loopDeps(effort: Effort): AgentLoopDeps {
    return {
      gateway: this.gateway,
      registry: this.registry,
      executor: this.executor,
      contextManager: this.contextManager,
      ledger: this.ledger,
      sandbox: this.sandbox,
      memory: this.memory,
      clock: this.clock,
      logger: this.logger,
      config: { ...this.loopConfig, effort },
      hooks: this.hooks,
      spawn: (def, prompt, signal) => this.spawn(def, prompt, signal),
      depth: 0,
      spillDir: this.spillDir,
    };
  }

  /** Run a lifecycle hook best-effort: a failing hook emits a notice, never breaks the run. */
  private async safeLifecycle<T>(label: string, fn: () => Promise<T>, emit: EventSink, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      emit({ type: "notice", level: "warn", message: `${label} hook failed: ${err instanceof Error ? err.message : String(err)}` });
      return fallback;
    }
  }

  /**
   * Run a sub-agent for the Task tool: a fresh context window over the SHARED
   * workspace with an isolated read-ledger (runSubagent handles that), at depth 1
   * so it can't itself spawn. Uses the agent definition's prompt/turn limits.
   */
  private spawn(def: AgentDefinition, prompt: string, signal: AbortSignal): Promise<SubagentRunResult> {
    // Filter the tool pool to the agent definition (always minus Task — no nesting),
    // and bind a sub-executor to that smaller registry under the same engine/hooks.
    const subRegistry = this.registry.filter(def.tools);
    const subExecutor = new ToolExecutor(subRegistry, this.engine, this.hooks, this.clock);
    const deps: AgentLoopDeps = {
      ...this.loopDeps(this.defaultEffort),
      registry: subRegistry,
      executor: subExecutor,
      depth: 1,
      config: {
        ...this.loopConfig,
        effort: this.defaultEffort,
        promptVariant: "subagent",
        promptOverride: def.systemPrompt,
        // Sub-agents stay BOUNDED even when the main loop is uncapped: nobody watches a
        // sub-agent directly, so an unbounded one is a worse runaway. Fall back to a generous
        // finite default when neither the definition nor the (now uncapped) main loop sets one.
        maxTurns: def.maxTurns ?? this.loopConfig.maxTurns ?? DEFAULT_SUBAGENT_MAX_TURNS,
      },
    };
    return runSubagent(prompt, deps, { workspace: this.workspace, signal });
  }

  async run(opts: RunOptions, emit: EventSink, signal: AbortSignal): Promise<RunOutcome> {
    let session = opts.sessionId ? await this.store.get(opts.sessionId) : undefined;
    if (opts.sessionId && !session) throw new Error(`Session not found: ${opts.sessionId}`);
    if (!session) {
      session = await this.store.create({
        id: this.idGen(),
        model: this.gateway.model,
        title: opts.title || titleFromPrompt(opts.prompt),
        cwd: this.workspace.root,
      });
    }
    // SessionStart — hooks may contribute context, injected as synthetic user
    // messages BEFORE the prompt the loop pushes.
    const source = opts.sessionId ? "resume" : "new";
    const startContext = await this.safeLifecycle(
      "SessionStart",
      () => this.hooks.runSessionStart({ sessionId: session!.id, source }),
      emit,
      [] as string[],
    );
    for (const ctx of startContext) session.messages.push({ role: "user", content: ctx });

    try {
      // Passive auto-memory: read the project memory index ONCE for this turn and inject
      // it via projectRules (a synthetic user message, re-sent each turn, survives
      // compaction). Top-level run only — sub-agents get a fresh context (spawn omits it).
      const memorySection = await loadMemoryIndex(this.memory).catch(() => "");
      const base = this.loopDeps(opts.effort ?? this.defaultEffort);
      // The blocking Stop hook fires INSIDE the loop (at the completion point) so it
      // can force another turn; here we only persist + SessionEnd afterward.
      const deps: AgentLoopDeps = {
        ...base,
        steering: opts.steering,
        config: { ...base.config, memorySection: memorySection || undefined },
      };
      const result = await runAgentLoop(session, opts.prompt, this.workspace, deps, emit, signal);
      return { session, result };
    } finally {
      // Persist + SessionEnd run even on a thrown error, so state is never lost.
      await this.store.save(session);
      await this.safeLifecycle("SessionEnd", () => this.hooks.runSessionEnd({ sessionId: session!.id }), emit, undefined);
    }
  }

  /**
   * User-initiated compaction (the TUI's /compact). Compacts the given session NOW,
   * ignoring the size thresholds the passive path waits for: clears old tool results
   * and LLM-summarizes the history, then persists. Emits a compact_boundary (the ⟳
   * chip) + a refreshed budget so the context gauge updates, and returns what changed
   * (status "empty" when there's no session yet, "noop" when nothing could be freed).
   */
  async compact(sessionId: string | undefined, emit: EventSink, signal: AbortSignal): Promise<ManualCompactResult> {
    const empty: ManualCompactResult = { status: "empty", tokensBefore: 0, tokensAfter: 0, clearedCount: 0, summarized: false };
    if (!sessionId) return empty;
    const session = await this.store.get(sessionId);
    if (!session || session.messages.length === 0) return empty;

    // Rebuild the same prompt/rules/tools snapshot the loop uses (incl. the passive memory
    // index), so the token estimate — and thus what counts as "freed" — matches a real turn.
    const memorySection = await loadMemoryIndex(this.memory).catch(() => "");
    const loop = buildLoopConfig(
      { ...this.loopConfig, effort: this.defaultEffort, memorySection: memorySection || undefined },
      this.registry,
      this.workspace.root,
    );

    // PreCompact lifecycle hook (manual trigger), best-effort.
    await this.safeLifecycle("PreCompact", () => this.hooks.runPreCompact({ sessionId: session.id, trigger: "manual" }), emit, undefined);

    const result = await this.contextManager.compactManually(
      session,
      { system: loop.system, projectRules: loop.projectRules, tools: loop.tools, ledger: this.ledger, workspace: this.workspace },
      emit,
      signal,
    );

    // The transcript changed: the previous turn's authoritative input count no longer
    // applies (clearing it stops the next turn from re-compacting on a stale estimate),
    // and we persist so a later /resume sees the compacted history.
    session.lastRealInputTokens = undefined;
    await this.store.save(session);

    // Refresh the context gauge with the post-compaction estimate.
    emit({ type: "budget", ...computeBudget(loop.contextTokens, result.tokensAfter) });
    return result;
  }

  /**
   * Per-block context composition for the TUI's /context command. Rebuilds the same
   * prompt/rules/tools snapshot a real turn uses (so the numbers match what the model
   * actually receives) and attributes the estimated token cost across the request's
   * blocks. The estimate is the loop's own char-heuristic; the server returns only one
   * aggregate count, so the report also carries the authoritative realUsedTokens (when a
   * turn has happened) for the renderer to show as the honest headline. Returns null
   * before any conversation exists.
   */
  async contextReport(sessionId: string | undefined): Promise<ContextReport | null> {
    if (!sessionId) return null;
    const session = await this.store.get(sessionId);
    if (!session || session.messages.length === 0) return null;

    const memorySection = await loadMemoryIndex(this.memory).catch(() => "");
    const loop = buildLoopConfig(
      { ...this.loopConfig, effort: this.defaultEffort, memorySection: memorySection || undefined },
      this.registry,
      this.workspace.root,
    );
    const blocks = computeContextBreakdown({
      system: loop.system,
      projectRules: loop.projectRules,
      memorySection: memorySection || undefined,
      messages: session.messages,
      tools: loop.tools,
    });
    return {
      blocks,
      estimatedTotal: blocks.reduce((sum, b) => sum + b.tokens, 0),
      contextTokens: loop.contextTokens,
      realUsedTokens: session.lastRealInputTokens,
      summarized: session.messages[0]?.role === "summary",
    };
  }

  resolvePermission(requestId: string, decision: BrokerDecision): boolean {
    return this.broker.resolve(requestId, decision);
  }

  /** The current permission mode (for the TUI's mode indicator / cycle). */
  get permissionMode(): PermissionMode {
    return this.engine.getMode();
  }
  setPermissionMode(mode: PermissionMode): void {
    this.engine.setMode(mode);
  }

  /** Exit plan mode, pre-approving the plan's allowedPrompts as session allow-rules. */
  exitPlanMode(allowedPrompts: { tool: string; prompt: string }[] = [], to: PermissionMode = "acceptEdits"): void {
    this.engine.exitPlanMode(allowedPrompts, to);
  }

  /**
   * Apply a permission update from an "always allow" choice: update the engine
   * in-memory (so the in-flight call and the rest of the session honor it) AND, for
   * a persistent destination, write it to that scope's settings file.
   */
  persistPermission(update: PermissionUpdate): void {
    if (update.type === "addRules") {
      this.engine.addRules(update.rules.map((r) => ({ source: update.destination, behavior: update.behavior, value: ruleValueFromString(r) })));
    } else if (update.type === "setMode") {
      this.engine.setMode(update.mode);
    }
    if (this.settingsFiles && supportsPersistence(update.destination)) {
      persistPermissionUpdate(this.settingsFiles[update.destination], update);
    }
  }

  pendingPermissions(): string[] {
    return this.broker.pendingIds();
  }

  /** The model id behind the gateway (for display before the first turn). */
  get model(): string {
    return this.gateway.model;
  }

  /** The workspace root the agent edits. */
  get cwd(): string {
    return this.workspace.root;
  }

  /**
   * Sessions for the current project. Isolation is STRUCTURAL: the CLI roots the
   * session store in a per-project directory, so the store only ever contains
   * this workspace's sessions. (See packages/cli/src/projects.ts.)
   */
  listSessions(): Promise<SessionSummary[]> {
    return this.store.list();
  }

  /** Workspace files as paths relative to the root (for @-mention completion), gitignore-aware, secrets excluded. */
  async listFiles(limit = 1000): Promise<string[]> {
    const root = this.workspace.root;
    const abs = await this.workspace.walk({ respectGitignore: true, limit });
    return abs
      .map((a) => relative(root, a).split("\\").join("/"))
      .filter((p) => p.length > 0 && !isSecretPath(p));
  }

  getSession(id: string) {
    return this.store.get(id);
  }
}

export function createAgentRuntime(opts: AgentRuntimeOptions): AgentRuntime {
  return new AgentRuntime(opts);
}
