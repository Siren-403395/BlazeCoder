/**
 * Hook bus — the primary extension seam. New guardrails (validation, formatters,
 * linters, audit logging) register here and need ZERO changes to the loop.
 *
 * Lifecycle points modeled on Claude Code's hooks: PreToolUse / PostToolUse /
 * UserPromptSubmit / Stop / PreCompact / SessionStart / SessionEnd.
 */

import type { Tool, ToolResult } from "../tools/registry";

export type PreToolUseDecision =
  | { decision: "allow"; updatedInput?: Record<string, unknown> }
  | { decision: "deny"; message: string }
  | { decision: "ask"; reason: string }
  /** No opinion — defer to the next gate. */
  | { decision: "continue" };

export interface PreToolUseHookInput {
  toolName: string;
  input: Record<string, unknown>;
  tool: Tool;
}

export type PreToolUseHook = (
  input: PreToolUseHookInput,
) => PreToolUseDecision | Promise<PreToolUseDecision>;

export interface PostToolUseHookInput {
  toolName: string;
  input: Record<string, unknown>;
  result: ToolResult;
}

/** Return a replacement result to transform output, or void to leave it unchanged. */
export type PostToolUseHook = (
  input: PostToolUseHookInput,
) => ToolResult | void | Promise<ToolResult | void>;

export type SimpleHook = (payload: Record<string, unknown>) => void | Promise<void>;

export class HookBus {
  private readonly preToolUse: PreToolUseHook[] = [];
  private readonly postToolUse: PostToolUseHook[] = [];
  private readonly preCompact: SimpleHook[] = [];
  private readonly sessionStart: SimpleHook[] = [];
  private readonly sessionEnd: SimpleHook[] = [];
  private readonly stop: SimpleHook[] = [];

  onPreToolUse(hook: PreToolUseHook): this {
    this.preToolUse.push(hook);
    return this;
  }
  onPostToolUse(hook: PostToolUseHook): this {
    this.postToolUse.push(hook);
    return this;
  }
  onPreCompact(hook: SimpleHook): this {
    this.preCompact.push(hook);
    return this;
  }
  onSessionStart(hook: SimpleHook): this {
    this.sessionStart.push(hook);
    return this;
  }
  onSessionEnd(hook: SimpleHook): this {
    this.sessionEnd.push(hook);
    return this;
  }
  onStop(hook: SimpleHook): this {
    this.stop.push(hook);
    return this;
  }

  /**
   * Run all PreToolUse hooks. Resolution: any deny wins; else any ask wins; else
   * the merged updatedInput from allow hooks is applied. Returns "continue" if no
   * hook had an opinion.
   */
  async runPreToolUse(input: PreToolUseHookInput): Promise<PreToolUseDecision> {
    let mergedInput: Record<string, unknown> | undefined;
    let askReason: string | undefined;
    for (const hook of this.preToolUse) {
      const decision = await hook(input);
      if (decision.decision === "deny") return decision;
      if (decision.decision === "ask") askReason ??= decision.reason;
      if (decision.decision === "allow" && decision.updatedInput) {
        mergedInput = { ...(mergedInput ?? input.input), ...decision.updatedInput };
      }
    }
    if (askReason) return { decision: "ask", reason: askReason };
    if (mergedInput) return { decision: "allow", updatedInput: mergedInput };
    return { decision: "continue" };
  }

  async runPostToolUse(input: PostToolUseHookInput): Promise<ToolResult> {
    let result = input.result;
    for (const hook of this.postToolUse) {
      const next = await hook({ ...input, result });
      if (next) result = next;
    }
    return result;
  }

  async runPreCompact(payload: Record<string, unknown>): Promise<void> {
    for (const hook of this.preCompact) await hook(payload);
  }
  async runSessionStart(payload: Record<string, unknown>): Promise<void> {
    for (const hook of this.sessionStart) await hook(payload);
  }
  async runSessionEnd(payload: Record<string, unknown>): Promise<void> {
    for (const hook of this.sessionEnd) await hook(payload);
  }
  async runStop(payload: Record<string, unknown>): Promise<void> {
    for (const hook of this.stop) await hook(payload);
  }
}
