/**
 * The loop's THREE-way split: an immutable LoopRunConfig snapshot (computed once
 * from AgentLoopConfig + the registry), the injected AgentLoopDeps (the IO seam),
 * and the per-iteration LoopState (transitions.ts). buildLoopConfig is the pure
 * function that derives the snapshot — the joined system prompt, project rules,
 * tool schemas, and resolved effort knobs — so the loop body reads constants, not
 * recomputed values. (The per-request output budget is NOT snapshotted here: the loop
 * sizes it each turn from the live input estimate so output can use the whole window.)
 */

import { MODEL_MAX_OUTPUT_TOKENS, resolveEffort } from "../effort";
import type { ThinkingBudget } from "../effort";
import { buildProjectRules } from "../memory/projectRules";
import { buildSystemPrompt } from "../prompts";
import type { ToolSchema } from "../ports";
import type { ToolRegistry } from "../tools/registry";
import type { AgentLoopConfig } from "./agentLoop";

export interface LoopRunConfig {
  /** The joined system prompt (sections gated on the registered tools + effort). */
  system: string;
  /** The per-turn environment/rules block injected as a synthetic user message. */
  projectRules: string;
  /** Tool schemas handed to the gateway. */
  tools: ToolSchema[];
  thinking: boolean;
  thinkingBudget?: ThinkingBudget;
  /** Ceiling for the per-request output budget (default: the model max). The loop sizes the
   *  actual max_tokens per turn = min(this, window − input), so output is unleashed, not fixed. */
  maxOutputCap: number;
  temperature?: number;
  /** Tool-use turn cap; undefined = unlimited (see AgentLoopConfig). */
  maxTurns?: number;
  /** $ cost cap; undefined = unlimited. */
  maxBudgetUsd?: number;
  contextTokens: number;
}

export function buildLoopConfig(config: AgentLoopConfig, registry: ToolRegistry, workspaceRoot: string): LoopRunConfig {
  const { thinking, budget } = resolveEffort(config.effort);
  const system = buildSystemPrompt({
    toolNames: new Set(registry.names()),
    effort: config.effort,
    modePrompt: config.modePrompt,
    override: config.promptOverride,
    extra: config.extraInstructions,
    variant: config.promptVariant,
  }).join("\n\n");
  return {
    system,
    projectRules: buildProjectRules({ root: workspaceRoot, userRules: config.userRules, memory: config.memorySection }),
    tools: registry.schemas(),
    thinking,
    thinkingBudget: budget,
    maxOutputCap: config.maxOutputTokens ?? MODEL_MAX_OUTPUT_TOKENS,
    temperature: config.temperature,
    maxTurns: config.maxTurns,
    maxBudgetUsd: config.maxBudgetUsd,
    contextTokens: config.contextTokens,
  };
}
