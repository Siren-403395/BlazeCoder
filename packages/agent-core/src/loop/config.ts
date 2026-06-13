/**
 * The loop's THREE-way split: an immutable LoopRunConfig snapshot (computed once
 * from AgentLoopConfig + the registry), the injected AgentLoopDeps (the IO seam),
 * and the per-iteration LoopState (transitions.ts). buildLoopConfig is the pure
 * function that derives the snapshot — the joined system prompt, project rules,
 * tool schemas, and resolved effort knobs — so the loop body reads constants, not
 * recomputed values. (maxOutputTokens stays a per-run mutable local because
 * output-truncation recovery escalates it.)
 */

import { resolveEffort } from "../effort";
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
  /** Starting output budget (the loop escalates a mutable copy on truncation). */
  baseMaxOutputTokens: number;
  temperature?: number;
  maxTurns: number;
  maxBudgetUsd: number;
  contextTokens: number;
}

export function buildLoopConfig(config: AgentLoopConfig, registry: ToolRegistry, workspaceRoot: string): LoopRunConfig {
  const { thinking, budget, maxOutputTokens } = resolveEffort(config.effort, config.maxOutputTokens);
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
    projectRules: buildProjectRules({ root: workspaceRoot, userRules: config.userRules }),
    tools: registry.schemas(),
    thinking,
    thinkingBudget: budget,
    baseMaxOutputTokens: maxOutputTokens,
    temperature: config.temperature,
    maxTurns: config.maxTurns,
    maxBudgetUsd: config.maxBudgetUsd,
    contextTokens: config.contextTokens,
  };
}
