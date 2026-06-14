/**
 * Permission engine — ordered gates over LAYERED RULES with behavior priority.
 *
 * Gate order (mirrors the reference clone):
 *   1. hooks (PreToolUse can deny / force-ask / decisively allow)
 *   2. protected paths (never auto-approved except bypass)
 *   3. deny rules   (any source — a deny anywhere wins)
 *   4. allow rules  (any source)
 *   5. ask rules    (any source → force a human prompt)
 *   6. mode disposition (default/acceptEdits/plan/bypass)
 *   7. read-only / control tools auto-allow
 *   8. ask the human via the broker
 *
 * Rules carry a source for display/scoping, but EVALUATION is behavior-first:
 * deny beats allow beats ask, regardless of which file the rule came from. The
 * engine still returns ALLOW or DENY only; "ask" is resolved internally by
 * emitting a permission_request and awaiting the human decision. Every decision
 * carries a `decisionReason` so the TUI can explain WHY and hint /permissions.
 */

import type { PermissionMode, PermissionRule, RuleBehavior, RuleSource } from "@zephyrcode/shared";
import type { EventSink } from "../ports";
import type { Tool } from "../tools/registry";
import { TOOL_NAMES } from "../tools/toolNames";
import { HookBus } from "./hooks";
import { isProtectedPath } from "./protectedPaths";
import { matchesRule, ruleValueFromString, ruleValueToString } from "./rule";
import { getSuggestions } from "./suggestions";

export type { PermissionMode, PermissionRule, PermissionRuleValue, PermissionSettings, RuleBehavior, RuleSource } from "@zephyrcode/shared";

/** Why a decision was reached — drives TUI explanations and analytics. */
export type DecisionReason =
  | { type: "rule"; rule: PermissionRule }
  | { type: "mode"; mode: PermissionMode }
  | { type: "hook"; detail?: string }
  | { type: "protected" }
  | { type: "other"; detail?: string };

export type PermissionDecision =
  | { behavior: "allow"; input: Record<string, unknown>; decisionReason: DecisionReason }
  | { behavior: "deny"; message: string; decisionReason: DecisionReason };

export interface BrokerDecision {
  behavior: "allow" | "deny";
  updatedInput?: Record<string, unknown>;
  message?: string;
}

/** Bridges the in-loop "ask" gate to an out-of-band decision (the TUI / an HTTP endpoint). */
export class PermissionBroker {
  private readonly pending = new Map<string, (d: BrokerDecision) => void>();

  request(requestId: string, signal?: AbortSignal): Promise<BrokerDecision> {
    return new Promise<BrokerDecision>((resolve) => {
      this.pending.set(requestId, resolve);
      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            if (this.pending.delete(requestId)) resolve({ behavior: "deny", message: "Run cancelled." });
          },
          { once: true },
        );
      }
    });
  }

  resolve(requestId: string, decision: BrokerDecision): boolean {
    const resolver = this.pending.get(requestId);
    if (!resolver) return false;
    this.pending.delete(requestId);
    resolver(decision);
    return true;
  }

  pendingIds(): string[] {
    return [...this.pending.keys()];
  }
}

/** Tools whose writes acceptEdits should auto-allow. */
const EDIT_TOOLS = new Set<string>([TOOL_NAMES.write, TOOL_NAMES.edit, TOOL_NAMES.memory]);
/**
 * Tools auto-allowed in every mode. TodoWrite is side-effect-free. Task only
 * LAUNCHES a sub-agent — the sub-agent runs under this same engine, so each of its
 * own actions is permission-checked independently; gating the launch too would just
 * double-prompt. A deny rule on Task still blocks it (rules run before this gate).
 */
const CONTROL_TOOLS = new Set<string>([TOOL_NAMES.todo, TOOL_NAMES.task]);

export interface PermissionEngineOptions {
  mode?: PermissionMode;
  /** Pre-parsed layered rules (from settings files), evaluated by behavior priority. */
  rules?: PermissionRule[];
  /** CLI --allow/--deny/--ask rule strings, parsed as the `cliArg` source. */
  allow?: string[];
  deny?: string[];
  ask?: string[];
  hookBus: HookBus;
  broker: PermissionBroker;
  idGen: () => string;
  /** Maps a rule source to the directory its settings file lives in (source-relative path globs). */
  sourceRootDir?: (source: RuleSource) => string | undefined;
}

export class PermissionEngine {
  private mode: PermissionMode;
  private readonly rules: PermissionRule[];
  private readonly hookBus: HookBus;
  private readonly broker: PermissionBroker;
  private readonly idGen: () => string;
  private readonly sourceRootDir?: (source: RuleSource) => string | undefined;

  constructor(opts: PermissionEngineOptions) {
    this.mode = opts.mode ?? "default";
    this.hookBus = opts.hookBus;
    this.broker = opts.broker;
    this.idGen = opts.idGen;
    this.sourceRootDir = opts.sourceRootDir;
    this.rules = [
      ...(opts.rules ?? []),
      ...parseRules(opts.deny, "deny"),
      ...parseRules(opts.allow, "allow"),
      ...parseRules(opts.ask, "ask"),
    ];
  }

  /** Current permission mode (plan-mode exit and the TUI need to read/flip this). */
  getMode(): PermissionMode {
    return this.mode;
  }
  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  /** Inject rules at runtime (e.g. session-scope allows from a plan-mode exit). */
  addRules(rules: PermissionRule[]): void {
    this.rules.push(...rules);
  }

  /**
   * Exit plan mode: switch to a working mode and pre-approve the command categories
   * the plan declared (allowedPrompts) as session-scope allow-rules, so e.g. "npm
   * test" auto-runs afterward while "npm publish" still asks. Each prompt becomes a
   * prefix rule (Bash(<prompt>:*)), reusing the P0 rule grammar.
   */
  exitPlanMode(allowedPrompts: { tool: string; prompt: string }[] = [], to: PermissionMode = "acceptEdits"): void {
    this.setMode(to);
    this.addRules(
      allowedPrompts.map((ap) => ({
        source: "session" as const,
        behavior: "allow" as const,
        value: { toolName: ap.tool, ruleContent: `${ap.prompt}:*` },
      })),
    );
  }

  /** First rule of `behavior` whose value matches this tool call, or undefined. */
  private firstMatch(behavior: RuleBehavior, toolName: string, input: Record<string, unknown>): PermissionRule | undefined {
    for (const rule of this.rules) {
      if (rule.behavior !== behavior) continue;
      if (matchesRule(rule.value, toolName, input, { behavior, sourceRootDir: this.sourceRootDir?.(rule.source) })) {
        return rule;
      }
    }
    return undefined;
  }

  async check(
    tool: Tool,
    input: Record<string, unknown>,
    run: { emit: EventSink; signal: AbortSignal },
  ): Promise<PermissionDecision> {
    // 1) Hooks.
    const hook = await this.hookBus.runPreToolUse({ toolName: tool.name, input, tool });
    if (hook.decision === "deny") return { behavior: "deny", message: hook.message, decisionReason: { type: "hook" } };
    if (hook.decision === "allow") {
      return { behavior: "allow", input: hook.updatedInput ?? input, decisionReason: { type: "hook" } };
    }
    let forceAsk = false;
    let askReason = `Allow ${tool.name}?`;
    let askDecisionReason: DecisionReason = { type: "mode", mode: this.mode };
    if (hook.decision === "ask") {
      forceAsk = true;
      askReason = hook.reason;
      askDecisionReason = { type: "hook", detail: hook.reason };
    }

    // 2) Protected paths.
    const targetPath =
      typeof input.file_path === "string" ? input.file_path : typeof input.path === "string" ? input.path : undefined;
    if (targetPath && isProtectedPath(targetPath) && this.mode !== "bypassPermissions") {
      return { behavior: "deny", message: `Path is protected and cannot be modified: ${targetPath}`, decisionReason: { type: "protected" } };
    }

    // 3) Deny rules (any source).
    const denyRule = this.firstMatch("deny", tool.name, input);
    if (denyRule) {
      return {
        behavior: "deny",
        message: `Denied by rule ${ruleValueToString(denyRule.value)} (${denyRule.source} settings).`,
        decisionReason: { type: "rule", rule: denyRule },
      };
    }

    // 4) Allow rules (skip when a hook forced ask).
    if (!forceAsk) {
      const allowRule = this.firstMatch("allow", tool.name, input);
      if (allowRule) return { behavior: "allow", input, decisionReason: { type: "rule", rule: allowRule } };
    }

    // 5) Ask rules.
    const askRule = this.firstMatch("ask", tool.name, input);
    if (askRule) {
      forceAsk = true;
      askReason = `Allow ${tool.name}? (matched ask rule ${ruleValueToString(askRule.value)})`;
      askDecisionReason = { type: "rule", rule: askRule };
    }

    // 6) Mode disposition.
    const disposition: "allow" | "ask" | "deny" = forceAsk ? "ask" : this.modeDisposition(tool);
    if (disposition === "allow") return { behavior: "allow", input, decisionReason: { type: "mode", mode: this.mode } };
    if (disposition === "deny") {
      return { behavior: "deny", message: `Tool "${tool.name}" is not permitted in ${this.mode} mode.`, decisionReason: { type: "mode", mode: this.mode } };
    }

    // 7) Ask the human. Register BEFORE emitting so a fast client can't race the awaiting promise.
    const requestId = this.idGen();
    const pending = this.broker.request(requestId, run.signal);
    run.emit({ type: "permission_request", requestId, toolName: tool.name, input, reason: askReason, suggestions: getSuggestions(tool.name, input) });
    const decision = await pending;
    if (decision.behavior === "allow") {
      return { behavior: "allow", input: decision.updatedInput ?? input, decisionReason: askDecisionReason };
    }
    return { behavior: "deny", message: decision.message ?? "Denied by user.", decisionReason: askDecisionReason };
  }

  private modeDisposition(tool: Tool): "allow" | "ask" | "deny" {
    if (CONTROL_TOOLS.has(tool.name)) return "allow"; // side-effect-free control tools
    switch (this.mode) {
      case "bypassPermissions":
        return "allow";
      case "plan":
        return tool.readOnly ? "allow" : "deny";
      case "acceptEdits":
        return tool.readOnly || EDIT_TOOLS.has(tool.name) ? "allow" : "ask";
      case "default":
      default:
        return tool.readOnly ? "allow" : "ask";
    }
  }
}

function parseRules(strings: string[] | undefined, behavior: RuleBehavior): PermissionRule[] {
  return (strings ?? []).map((s) => ({ source: "cliArg" as const, behavior, value: ruleValueFromString(s) }));
}
