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
  Workspace,
} from "./ports";
import { builtinTools } from "./tools/builtin";
import type { Tool } from "./tools/registry";
import { ToolRegistry } from "./tools/registry";
import { ToolExecutor } from "./tools/executor";
import { HookBus } from "./permissions/hooks";
import type { PreToolUseHook } from "./permissions/hooks";
import { PermissionBroker, PermissionEngine } from "./permissions/engine";
import type { BrokerDecision, PermissionMode } from "./permissions/engine";
import { ContextManager, DEFAULT_COMPACTION } from "./context/compaction";
import type { CompactionConfig } from "./context/compaction";
import type { Effort } from "./effort";
import { FileSystemWorkspace } from "./workspace/fsWorkspace";
import { ReadLedger } from "./workspace/ledger";
import { runAgentLoop } from "./loop/agentLoop";
import type { AgentLoopConfig, AgentLoopDeps, AgentRunResult } from "./loop/agentLoop";
import { CODING_AGENT_SYSTEM_PROMPT } from "./prompts";
import { silentLogger, systemClock } from "./util";

// ─── Re-exports (public API surface) ──────────────────────────────────────────
export * from "./ports";
export * from "./tools/registry";
export * from "./tools/executor";
export * from "./tools/builtin";
export * from "./permissions/hooks";
export * from "./permissions/engine";
export * from "./permissions/protectedPaths";
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
  system?: string;
  userRules?: string;
  permissionMode?: PermissionMode;
  allow?: string[];
  deny?: string[];
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

    this.registry = new ToolRegistry().registerAll(opts.tools ?? builtinTools());
    this.hooks = new HookBus().onPreToolUse(secretsHook);
    this.broker = new PermissionBroker();
    const engine = new PermissionEngine({
      mode: opts.permissionMode ?? "acceptEdits",
      allow: opts.allow,
      deny: opts.deny,
      hookBus: this.hooks,
      broker: this.broker,
      idGen: this.idGen,
    });
    this.executor = new ToolExecutor(this.registry, engine, this.hooks, this.clock);

    const contextTokens = opts.contextTokens ?? DEFAULT_COMPACTION.contextTokens;
    this.contextManager = new ContextManager(
      { ...DEFAULT_COMPACTION, contextTokens, ...opts.compaction },
      this.clock,
      this.logger,
      this.gateway,
    );

    this.loopConfig = {
      system: opts.system ?? CODING_AGENT_SYSTEM_PROMPT,
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
    };
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
    const result = await runAgentLoop(
      session,
      opts.prompt,
      this.workspace,
      this.loopDeps(opts.effort ?? this.defaultEffort),
      emit,
      signal,
    );
    await this.store.save(session);
    return { session, result };
  }

  resolvePermission(requestId: string, decision: BrokerDecision): boolean {
    return this.broker.resolve(requestId, decision);
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
