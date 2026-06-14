/**
 * Permission rule grammar — parsing `ToolName` / `ToolName(content)` strings and
 * dispatching a content rule to the right per-tool matcher. Ported (faithfully)
 * from the reference clone's permissionRuleParser + the tool-specific matchers.
 *
 * The same `ToolName(content)` shape means different things per tool:
 *   - Bash(git commit:*)  → a shell command pattern   (bashRuleMatch)
 *   - Read(src/**)        → a file-path glob           (pathRuleMatch)
 *   - Task(explorer)      → an agent-type selector     (exact)
 * A whole-tool rule (no content) matches any input to that tool.
 */

import type { PermissionRuleValue, RuleBehavior } from "@zephyrcode/shared";
import { TOOL_NAMES } from "../tools/toolNames";
import { bashCommandMatchesRule } from "./bashRuleMatch";
import { pathMatchesRule } from "./pathRuleMatch";

// ─── String grammar (escaped parens) ─────────────────────────────────────────

export function escapeRuleContent(content: string): string {
  return content.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function unescapeRuleContent(content: string): string {
  return content.replace(/\\\(/g, "(").replace(/\\\)/g, ")").replace(/\\\\/g, "\\");
}

/** Index of the first/last occurrence of `char` preceded by an EVEN number of backslashes. */
function findUnescaped(str: string, char: string, fromEnd: boolean): number {
  const idxs = fromEnd ? [...Array(str.length).keys()].reverse() : [...Array(str.length).keys()];
  for (const i of idxs) {
    if (str[i] !== char) continue;
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && str[j] === "\\"; j--) backslashes++;
    if (backslashes % 2 === 0) return i;
  }
  return -1;
}

/** Parse a rule string into its value. `Tool()`/`Tool(*)` collapse to whole-tool. */
export function ruleValueFromString(ruleString: string): PermissionRuleValue {
  const open = findUnescaped(ruleString, "(", false);
  if (open === -1) return { toolName: ruleString };
  const close = findUnescaped(ruleString, ")", true);
  if (close === -1 || close <= open || close !== ruleString.length - 1) return { toolName: ruleString };
  const toolName = ruleString.slice(0, open);
  const rawContent = ruleString.slice(open + 1, close);
  if (!toolName) return { toolName: ruleString };
  if (rawContent === "" || rawContent === "*") return { toolName };
  return { toolName, ruleContent: unescapeRuleContent(rawContent) };
}

export function ruleValueToString(value: PermissionRuleValue): string {
  if (!value.ruleContent) return value.toolName;
  return `${value.toolName}(${escapeRuleContent(value.ruleContent)})`;
}

// ─── Matching ─────────────────────────────────────────────────────────────────

/** Does this rule's TOOL apply to `toolName`? (Exact, or MCP server-level prefix.) */
function toolNameMatches(ruleTool: string, toolName: string): boolean {
  if (ruleTool === toolName) return true;
  // MCP server-level: rule "mcp__server" matches any "mcp__server__toolX".
  return toolName.startsWith(`${ruleTool}__`);
}

export interface MatchOptions {
  /** The behavior of the rule being tested; deny/ask match more aggressively for Bash. */
  behavior?: RuleBehavior;
  /** Directory the rule's source settings file lives in, for source-relative path globs. */
  sourceRootDir?: string;
}

/**
 * Whether a rule matches a tool call. Whole-tool rules (no content) match any
 * input; content rules dispatch to the tool-specific matcher.
 */
export function matchesRule(
  value: PermissionRuleValue,
  toolName: string,
  input: Record<string, unknown>,
  opts: MatchOptions = {},
): boolean {
  if (!toolNameMatches(value.toolName, toolName)) return false;
  if (value.ruleContent === undefined) return true; // whole-tool

  switch (toolName) {
    case TOOL_NAMES.bash: {
      const command = typeof input.command === "string" ? input.command : "";
      return bashCommandMatchesRule(value.ruleContent, command, opts.behavior ?? "allow");
    }
    case TOOL_NAMES.read:
    case TOOL_NAMES.write:
    case TOOL_NAMES.edit: {
      const filePath = typeof input.file_path === "string" ? input.file_path : "";
      return pathMatchesRule(value.ruleContent, filePath, opts.sourceRootDir);
    }
    case TOOL_NAMES.task: {
      const subtype = typeof input.subagent_type === "string" ? input.subagent_type : "";
      return subtype === value.ruleContent;
    }
    default:
      // Generic content rule: exact match against a conventional string field.
      return false;
  }
}
