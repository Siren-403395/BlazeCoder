/**
 * agent-core public API + the AgentRuntime factory that wires every part together
 * behind injected ports. The CLI constructs one AgentRuntime and feeds its event
 * stream straight to the TUI in-process; tests construct one with in-memory fakes.
 */

import { relative } from "node:path";
import { isSecretPath, looksLikeSecret } from "@coding-agent/shared";
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
import { HookBus } from "./permissions/hooks";
import type { PreToolUseHook } from "./permissions/hooks";
import { PermissionBroker, PermissionEngine } from "./permissions/engine";
import type { BrokerDecision, PermissionMode } from "./permissions/engine";
import type { PermissionRule, RuleSource } from "@coding-agent/shared";
import { ContextManager, DEFAULT_COMPACTION } from "./context/compaction";
import type { CompactionConfig } from "./context/compaction";
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
export * from "./permissions/hooks";
export * from "./permissions/engine";
export * from "./permissions/protectedPaths";
export * from "./permissions/rule";
export * from "./permissions/bashRuleMatch";
export * from "./permissions/pathRuleMatch";
export * from "./permissions/settingsStore";
export * from "./permissions/update";
export * from "./context/sessionContext";
export * from "./context/compaction";
export * from "./context/rehydration";
export * from "./effort";
export * from "./memory/memoryStore";
export * from "./memory/memoryTool";
export * from "./memory/projectRules";
export * from "./session/store";
export * from "./workspace";
export * from "./util";
export * from "./prompts";
export * from "./loop/agentLoop";
export * from "./loop/transitions";
export * from "./orchestration/agentRegistry";
export * from "./orchestration/subagent";

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
  /** Custom sub-agent definitions (merged over the built-ins) for the Task tool. */
  agents?: AgentDefinition[];
  system?: string;
  userRules?: string;
  permissionMode?: PermissionMode;
  allow?: string[];
  deny?: string[];
  ask?: string[];
  /** Pre-parsed layered permission rules from settings files (user/project/local). */
  rules?: PermissionRule[];
  /** Maps a rule source to the dir its settings file is rooted at (source-relative path globs). */
  sourceRootDir?: (source: RuleSource) => string | undefined;
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
  private readonly loopConfig: AgentLoopConfig;
  private readonly defaultEffort: Effort;

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
      makeTaskTool(this.agentRegistry),
    ]);
    this.hooks = new HookBus().onPreToolUse(secretsHook);
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
    this.contextManager = new ContextManager(
      { ...DEFAULT_COMPACTION, contextTokens, ...opts.compaction },
      this.clock,
      this.logger,
      this.gateway,
    );

    this.loopConfig = {
      promptOverride: opts.system,
      userRules: opts.userRules,
      maxTurns: opts.maxTurns ?? 24,
      maxBudgetUsd: opts.maxBudgetUsd ?? 1,
      contextTokens,
      temperature: opts.temperature ?? 0.2,
      maxOutputTokens: opts.maxOutputTokens ?? 8000,
    };
    this.defaultEffort = opts.defaultEffort ?? "high";
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
        maxTurns: def.maxTurns ?? this.loopConfig.maxTurns,
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
      // The blocking Stop hook fires INSIDE the loop (at the completion point) so it
      // can force another turn; here we only persist + SessionEnd afterward.
      const deps = { ...this.loopDeps(opts.effort ?? this.defaultEffort), steering: opts.steering };
      const result = await runAgentLoop(session, opts.prompt, this.workspace, deps, emit, signal);
      return { session, result };
    } finally {
      // Persist + SessionEnd run even on a thrown error, so state is never lost.
      await this.store.save(session);
      await this.safeLifecycle("SessionEnd", () => this.hooks.runSessionEnd({ sessionId: session!.id }), emit, undefined);
    }
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
