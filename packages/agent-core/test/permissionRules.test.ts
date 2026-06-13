import { describe, expect, it } from "vitest";
import {
  bashCommandMatchesRule,
  matchesRule,
  pathMatchesRule,
  ruleValueFromString,
  ruleValueToString,
} from "../src/index";

describe("rule string grammar", () => {
  it("parses tool-only and tool(content) forms", () => {
    expect(ruleValueFromString("Bash")).toEqual({ toolName: "Bash" });
    expect(ruleValueFromString("Bash(npm install)")).toEqual({ toolName: "Bash", ruleContent: "npm install" });
  });

  it("collapses Tool() and Tool(*) to whole-tool", () => {
    expect(ruleValueFromString("Bash()")).toEqual({ toolName: "Bash" });
    expect(ruleValueFromString("Bash(*)")).toEqual({ toolName: "Bash" });
  });

  it("round-trips escaped parentheses", () => {
    const s = 'Bash(python -c "print(1)")';
    const v = ruleValueFromString(s);
    expect(v).toEqual({ toolName: "Bash", ruleContent: 'python -c "print(1)"' });
    expect(ruleValueToString(v)).toBe('Bash(python -c "print\\(1\\)")');
    expect(ruleValueFromString(ruleValueToString(v))).toEqual(v);
  });
});

describe("Bash command matching", () => {
  it("prefix rule is word-boundary safe", () => {
    expect(bashCommandMatchesRule("git:*", "git status", "allow")).toBe(true);
    expect(bashCommandMatchesRule("git:*", "git", "allow")).toBe(true);
    expect(bashCommandMatchesRule("git:*", "github clone", "allow")).toBe(false);
  });

  it("refuses to ALLOW a compound command via a prefix rule", () => {
    expect(bashCommandMatchesRule("git:*", "git status && rm -rf /", "allow")).toBe(false);
  });

  it("DENY matches a sub-command even when chained, and through leading env vars", () => {
    expect(bashCommandMatchesRule("rm:*", "git status && rm -rf /", "deny")).toBe(true);
    expect(bashCommandMatchesRule("rm:*", "FOO=bar rm -rf /tmp/x", "deny")).toBe(true);
  });

  it("wildcard rule with trailing ' *' also matches the bare command", () => {
    expect(bashCommandMatchesRule("git push *", "git push origin main", "allow")).toBe(true);
    expect(bashCommandMatchesRule("git push *", "git push", "allow")).toBe(true);
    expect(bashCommandMatchesRule("git push *", "git pull", "allow")).toBe(false);
  });

  it("ignores output redirections and safe wrappers when matching", () => {
    expect(bashCommandMatchesRule("python:*", "python train.py > out.txt", "allow")).toBe(true);
    expect(bashCommandMatchesRule("node:*", "timeout 30s node build.js", "allow")).toBe(true);
  });
});

describe("file-path glob matching", () => {
  it("bare globs match anywhere in the path", () => {
    expect(pathMatchesRule("src/**", "src/a.ts")).toBe(true);
    expect(pathMatchesRule("src/**", "/proj/src/a.ts")).toBe(true);
    expect(pathMatchesRule("src/**", "test/a.ts")).toBe(false);
  });

  it("// is an fs-absolute glob", () => {
    expect(pathMatchesRule("//Users/me/proj/**", "/Users/me/proj/src/a.ts")).toBe(true);
    expect(pathMatchesRule("//Users/me/proj/**", "/Users/you/other/a.ts")).toBe(false);
  });

  it("/rel is rooted at the source settings dir", () => {
    expect(pathMatchesRule("/src/**", "/proj/src/a.ts", "/proj")).toBe(true);
    expect(pathMatchesRule("/src/**", "/proj/lib/a.ts", "/proj")).toBe(false);
  });
});

describe("matchesRule dispatch", () => {
  it("whole-tool rule matches any input to that tool", () => {
    expect(matchesRule({ toolName: "Bash" }, "Bash", { command: "anything" })).toBe(true);
    expect(matchesRule({ toolName: "Bash" }, "Read", { file_path: "/a" })).toBe(false);
  });

  it("routes Bash/file/Task content rules to the right matcher", () => {
    expect(matchesRule({ toolName: "Bash", ruleContent: "git:*" }, "Bash", { command: "git status" })).toBe(true);
    expect(matchesRule({ toolName: "Read", ruleContent: "src/**" }, "Read", { file_path: "src/a.ts" })).toBe(true);
    expect(matchesRule({ toolName: "Task", ruleContent: "explorer" }, "Task", { subagent_type: "explorer" })).toBe(true);
    expect(matchesRule({ toolName: "Task", ruleContent: "explorer" }, "Task", { subagent_type: "builder" })).toBe(false);
  });

  it("MCP server-level rule matches any tool of that server", () => {
    expect(matchesRule({ toolName: "mcp__github" }, "mcp__github__create_issue", {})).toBe(true);
    expect(matchesRule({ toolName: "mcp__github" }, "mcp__gitlab__x", {})).toBe(false);
  });
});
