/**
 * Permission rule contracts — shared because they cross the boundary: the CLI
 * reads/writes them as settings files, agent-core evaluates them, and the TUI
 * explains them. The grammar is `ToolName` (whole-tool) or `ToolName(content)`,
 * where `content` is a Bash command pattern, a file glob, or an agent-type
 * selector depending on the tool. Modeled on the reference clone's PermissionRule.
 */

export type RuleBehavior = "allow" | "deny" | "ask";

/**
 * Where a rule came from. Authority for DISPLAY/tie-break is low→high in
 * PERMISSION_RULE_SOURCES, but EVALUATION uses behavior priority (deny > ask >
 * allow) across all sources, so a deny anywhere beats an allow anywhere.
 */
export type RuleSource = "user" | "project" | "local" | "cliArg" | "session";

export const PERMISSION_RULE_SOURCES: readonly RuleSource[] = ["user", "project", "local", "cliArg", "session"];

/** Sources that persist to a settings file (session/cliArg are in-memory only). */
export const PERSISTENT_RULE_SOURCES: readonly RuleSource[] = ["user", "project", "local"];

export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

export interface PermissionRuleValue {
  toolName: string;
  /** Absent ⇒ a whole-tool rule. Present ⇒ a content rule (command/glob/agent-type). */
  ruleContent?: string;
}

export interface PermissionRule {
  source: RuleSource;
  behavior: RuleBehavior;
  value: PermissionRuleValue;
}

/** On-disk settings shape for the user/project/local scopes. */
export interface PermissionSettings {
  permissions?: {
    allow?: string[];
    deny?: string[];
    ask?: string[];
    defaultMode?: PermissionMode;
  };
}
