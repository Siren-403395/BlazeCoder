/**
 * Agent registry — sub-agent definitions are DATA (description-routed), not code.
 * Adding a specialized sub-agent is a new row here, not a new branch in the loop.
 */

import { TOOL_NAMES } from "../tools/toolNames";

export interface AgentDefinition {
  name: string;
  /** When to use this agent (used for description-based routing). */
  description: string;
  /** Restrict to this tool subset; undefined = all tools. */
  tools?: string[];
  maxTurns?: number;
  systemPrompt?: string;
}

export const DEFAULT_AGENTS: AgentDefinition[] = [
  {
    name: "builder",
    description: "Builds and edits the app end to end. The default agent.",
    maxTurns: 24,
  },
  {
    name: "explorer",
    description:
      "Read-only investigation of the existing workspace. Returns a concise findings summary; makes no changes.",
    tools: [TOOL_NAMES.read, TOOL_NAMES.grep, TOOL_NAMES.glob],
    maxTurns: 8,
  },
];

export class AgentRegistry {
  private readonly agents = new Map<string, AgentDefinition>();

  constructor(defs: AgentDefinition[] = DEFAULT_AGENTS) {
    for (const def of defs) this.register(def);
  }

  register(def: AgentDefinition): this {
    this.agents.set(def.name, def);
    return this;
  }

  get(name: string): AgentDefinition | undefined {
    return this.agents.get(name);
  }

  list(): AgentDefinition[] {
    return [...this.agents.values()];
  }
}
