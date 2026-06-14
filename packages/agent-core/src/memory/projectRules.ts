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
