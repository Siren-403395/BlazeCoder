/**
 * Task — the model-callable delegation tool. It spawns a sub-agent (fresh context
 * window, shared workspace, isolated read-ledger) by `subagent_type`, runs it to
 * completion, and returns its distilled report as the tool result. Delegation lets
 * the main agent fan out broad exploration or independent sub-tasks without
 * polluting its own context with raw output. Sub-agents cannot nest.
 *
 * The hard part (isolation, no-nest) already lives in orchestration/subagent.ts;
 * this is the thin tool wrapper + the registry route. Wiring (ctx.spawn / ctx.depth)
 * is injected by the AgentRuntime.
 */

import type { Tool, ToolContext, ToolResult } from "../registry";
import { TOOL_NAMES } from "../toolNames";
import type { AgentRegistry } from "../../orchestration/agentRegistry";

export function makeTaskTool(registry: AgentRegistry): Tool {
  const types = registry.list().map((d) => d.name);
  const menu = registry
    .list()
    .map((d) => `- ${d.name}: ${d.description}`)
    .join("\n");

  return {
    name: TOOL_NAMES.task,
    readOnly: false,
    description: `Delegate a focused task to a specialized sub-agent that runs in its own fresh context and reports back. Use it to parallelize independent work or to protect your own context from raw output you won't need again — not for trivial one-step tasks you can do directly.

Available subagent_type values:
${menu}

Writing the prompt: brief the sub-agent like a smart colleague who just walked in — it has NOT seen this conversation. Explain what to accomplish and why; hand over the exact paths/commands for a lookup, or the precise question for an investigation. Never delegate the actual understanding — you own the decisions. The sub-agent's result is NOT visible to the user, so summarize what matters back to them yourself. Sub-agents cannot themselves spawn sub-agents.`,
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "A 3-5 word label for the task (for the progress display)." },
        subagent_type: { type: "string", enum: types, description: "Which specialized agent to run (defaults to builder)." },
        prompt: { type: "string", description: "The full, self-contained brief for the sub-agent." },
      },
      required: ["description", "prompt"],
      additionalProperties: false,
    },

    async execute(input, ctx: ToolContext): Promise<ToolResult> {
      if (!ctx.spawn || (ctx.depth ?? 0) > 0) {
        return { content: "Sub-agents cannot nest: a sub-agent may not spawn another sub-agent.", isError: true };
      }
      const type = typeof input.subagent_type === "string" && input.subagent_type ? input.subagent_type : "builder";
      const def = registry.get(type);
      if (!def) {
        return { content: `Unknown subagent_type "${type}". Available: ${types.join(", ")}.`, isError: true };
      }
      const prompt = typeof input.prompt === "string" ? input.prompt : "";
      if (!prompt.trim()) return { content: "Task requires a 'prompt' describing the work for the sub-agent.", isError: true };

      const result = await ctx.spawn(def, prompt, ctx.signal);
      if (!result.text.trim()) return { content: `Sub-agent (${type}) ended as ${result.subtype} with no output.`, isError: true };
      return { content: result.text };
    },
  };
}
