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
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
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

  /** The schemas handed to the model gateway. */
  schemas(): { name: string; description: string; inputSchema: JSONSchema }[] {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }
}
