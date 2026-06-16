/**
 * Tool contract + registry.
 *
 * A tool is the agent-computer interface. Per Anthropic, description quality is
 * load-bearing, and handlers must RETURN `{ isError: true }` on failure rather
 * than throw — a throw kills the whole run, an isError result lets the loop
 * self-correct.
 */

import type {
  Clock,
  EventSink,
  JSONSchema,
  Logger,
  MemoryStore,
  Sandbox,
  Workspace,
} from "../ports";
import type { ReadLedger } from "../workspace/ledger";
import type { AgentDefinition } from "../orchestration/agentRegistry";
import type { SubagentRunResult } from "../orchestration/subagent";
import { TOOL_NAMES } from "./toolNames";

export interface ToolContext {
  sessionId: string;
  workspace: Workspace;
  /** Read-before-edit ledger shared across the file tools for this run. */
  ledger: ReadLedger;
  sandbox: Sandbox;
  memory: MemoryStore;
  /** Tools emit dedicated events (file_change, notice) through this sink. */
  emit: EventSink;
  signal: AbortSignal;
  logger: Logger;
  clock: Clock;
  /** Spawn a sub-agent (injected by the runtime). Absent ⇒ delegation unavailable. */
  spawn?: (def: AgentDefinition, prompt: string, signal: AbortSignal) => Promise<SubagentRunResult>;
  /** Nesting depth; 0 for the main agent. The Task tool refuses when > 0 (no nesting). */
  depth?: number;
  /** Directory for spilled oversized tool output (absent ⇒ truncate instead of spill). */
  spillDir?: string;
}

export interface ToolResult {
  /** Concise text the model sees. Bulky payloads should go out as events instead. */
  content: string;
  isError?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  /** Read-only tools may run concurrently; mutating tools run sequentially. */
  readOnly: boolean;
  /**
   * Whether this tool's results are bulky AND regenerable, so compaction may clear old
   * ones in place to reclaim context (the agent can just re-run the tool). True for
   * read/search/shell/web dumps; false (default) for Edit/Write confirmations, which are
   * cheap and a useful audit record. Co-locating the policy here lets a new bulky tool
   * opt in without editing the compaction module.
   */
  compactable?: boolean;
  /** Spill threshold: results larger than this go to disk + a preview (default in the executor). */
  maxResultSizeChars?: number;
  /**
   * The longest this tool may legitimately run. A tool that enforces its own deadline AND cleans
   * up after it (e.g. Bash, whose sandbox times out a command — up to 10 min — and reaps the
   * process tree) declares it here so the executor's safety-net timeout sits ABOVE the tool's own
   * deadline instead of preempting it (which would both clip the allowed runtime and orphan the
   * still-running work). Omit ⇒ the executor's default backstop applies.
   */
  maxTimeoutMs?: number;
  /** Keyword hints for a future deferred-tool search (not yet active). */
  searchHint?: string;
  /** Marks a core tool that must never be deferred (not yet active). */
  alwaysLoad?: boolean;
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

/** A source of tools (built-ins, or — later — an MCP server). buildRuntime concatenates these. */
export interface ToolSource {
  tools(): Promise<Tool[]>;
}

const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): this {
    if (!TOOL_NAME_RE.test(tool.name)) {
      throw new Error(`Invalid tool name "${tool.name}" (must match ${TOOL_NAME_RE}).`);
    }
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  registerAll(tools: Tool[]): this {
    for (const tool of tools) this.register(tool);
    return this;
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  /**
   * A new registry holding only the allowed tools (undefined ⇒ all), minus any
   * denied — and ALWAYS excluding Task, so a sub-agent can never spawn its own
   * sub-agents (no-nest, enforced structurally, not just by the depth guard).
   */
  filter(allow?: string[], deny?: string[]): ToolRegistry {
    const allowSet = allow ? new Set(allow) : undefined;
    const denySet = new Set(deny ?? []);
    const next = new ToolRegistry();
    for (const tool of this.list()) {
      if (tool.name === TOOL_NAMES.task) continue;
      if (allowSet && !allowSet.has(tool.name)) continue;
      if (denySet.has(tool.name)) continue;
      next.register(tool);
    }
    return next;
  }

  /** The schemas handed to the model gateway. */
  schemas(): { name: string; description: string; inputSchema: JSONSchema }[] {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }
}
