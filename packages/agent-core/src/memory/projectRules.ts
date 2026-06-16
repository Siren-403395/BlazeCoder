/**
 * Project rules / environment block — our CLAUDE.md analog. Injected as a
 * synthetic user message AFTER the system prompt (advisory, keeps the system
 * prompt cacheable, survives compaction). For a CLI agent this is a small, high-
 * signal description of WHERE it is working (the cwd) plus any durable user or
 * project conventions. It deliberately does NOT dump the file tree; the agent
 * discovers files on demand with Glob/Grep/Read.
 */

export interface ProjectRulesInput {
  /** Absolute working directory the agent is operating in. */
  root: string;
  /** Durable conventions (framework choices, style, acceptance criteria). */
  userRules?: string;
  /** Optional volatile environment lines (platform, git status, model) injected by the frontend. */
  environment?: string[];
  /** Passively-recalled memory index (see autoMemory.loadMemoryIndex), injected as its own section. */
  memory?: string;
}

/**
 * Volatile environment lines describing the host OS + the shell the Bash tool runs through,
 * so the model adapts its shell commands to the platform (the #1 cause of failed commands on
 * Windows is the model emitting POSIX builtins into cmd.exe). Pure — the platform is passed in
 * (the loop passes process.platform) — so it stays unit-testable.
 */
export function platformEnvironmentLines(platform: NodeJS.Platform): string[] {
  const osName = platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : "Linux";
  if (platform === "win32") {
    return [
      `Platform: ${osName}. Shell commands run through cmd.exe, NOT a POSIX shell.`,
      "Do not use Unix-only commands (ls, cat, grep, rm, mv, cp, touch, sed, awk, export, heredocs) — they fail in cmd.exe. Use the dedicated Read/Write/Edit/Glob/Grep tools for file work, and cross-platform executables (git, node, npm/pnpm, python) for everything else. Chain dependent commands with && and use backslashes in Windows paths.",
    ];
  }
  return [`Platform: ${osName}. Shell commands run through a POSIX shell (/bin/sh).`];
}

export function buildProjectRules({ root, userRules, environment, memory }: ProjectRulesInput): string {
  return [
    "# Environment (advisory, refreshed each turn)",
    `Working directory: ${root}`,
    ...(environment ?? []),
    userRules ? `\n## Project conventions\n${userRules}` : "",
    memory ? `\n## Memory (recalled from past sessions)\n${memory}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
