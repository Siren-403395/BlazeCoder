/**
 * agent-core public API + the AgentRuntime factory that wires every part together
 * behind injected ports. The server constructs one AgentRuntime and exposes its
 * `run` over SSE; tests construct one with in-memory fakes.
 */

import {
  emptyProject,
  isUnsafeRelativePath,
  validateProjectFile,
} from "@coding-agent/shared";
import type {
  Clock,
  EventSink,
  Logger,
  MemoryStore,
  ModelGateway,
  Sandbox,
  SessionState,
  SessionStore,
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
import { InMemoryWorkspace } from "./workspace";
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
  compaction?: Partial<CompactionConfig>;
}

export interface RunOptions {
  prompt: string;
  /** Resume an existing session; omit to start a new one. */
  sessionId?: string;
  title?: string;
  /** Run the model in deep-thinking (reasoning) mode for this turn. */
  thinking?: boolean;
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

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "untitled-project"
  );
}

function titleFromPrompt(prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed || "Untitled session";
}

/** Deterministic enforcement of the validation primitive, independent of model output. */
const validationHook: PreToolUseHook = ({ toolName, input }) => {
  if (toolName === "write_file") {
    const path = typeof input.path === "string" ? input.path : "";
    const content = typeof input.content === "string" ? input.content : "";
    const v = validateProjectFile({ path, content });
    if (!v.ok) return { decision: "deny", message: `Rejected by validation: ${v.errors.join("; ")}` };
  }
  if (toolName === "edit_file" || toolName === "delete_file") {
    const path = typeof input.path === "string" ? input.path : "";
    if (!path.startsWith("/") || isUnsafeRelativePath(path) || path.toLowerCase().includes(".env")) {
      return { decision: "deny", message: `Unsafe or invalid path: ${path}` };
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
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly idGen: () => string;
  private readonly registry: ToolRegistry;
  private readonly executor: ToolExecutor;
  private readonly contextManager: ContextManager;
  private readonly loopConfig: AgentLoopConfig;

  constructor(opts: AgentRuntimeOptions) {
    this.store = opts.sessionStore;
    this.gateway = opts.gateway;
    this.memory = opts.memory;
    this.sandbox = opts.sandbox ?? disabledSandbox;
    this.clock = opts.clock ?? systemClock;
    this.logger = opts.logger ?? silentLogger;
    this.idGen = opts.idGen ?? makeIdGen(this.clock);

    this.registry = new ToolRegistry().registerAll(opts.tools ?? builtinTools());
    this.hooks = new HookBus().onPreToolUse(validationHook);
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
  }

  private loopDeps(thinking: boolean): AgentLoopDeps {
    return {
      gateway: this.gateway,
      registry: this.registry,
      executor: this.executor,
      contextManager: this.contextManager,
      sandbox: this.sandbox,
      memory: this.memory,
      clock: this.clock,
      logger: this.logger,
      config: { ...this.loopConfig, thinking },
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
        project: emptyProject(slug(opts.title || opts.prompt)),
      });
    }
    const workspace = new InMemoryWorkspace(session.project);
    const result = await runAgentLoop(session, opts.prompt, workspace, this.loopDeps(opts.thinking ?? false), emit, signal);
    session.project = workspace.snapshot();
    await this.store.save(session);
    return { session, result };
  }

  resolvePermission(requestId: string, decision: BrokerDecision): boolean {
    return this.broker.resolve(requestId, decision);
  }

  pendingPermissions(): string[] {
    return this.broker.pendingIds();
  }

  listSessions() {
    return this.store.list();
  }

  getSession(id: string) {
    return this.store.get(id);
  }
}

export function createAgentRuntime(opts: AgentRuntimeOptions): AgentRuntime {
  return new AgentRuntime(opts);
}
