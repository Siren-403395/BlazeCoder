/**
 * Project rules — our CLAUDE.md analog. Injected as a synthetic user message
 * AFTER the system prompt (advisory, keeps the system prompt cacheable, survives
 * compaction). Gives the model a live, high-signal view of the workspace (the
 * current file list) each turn, so it rarely needs to call list_files, plus any
 * durable user/project conventions.
 */

import type { GeneratedProject } from "@coding-agent/shared";

export interface ProjectRulesInput {
  project: GeneratedProject;
  /** Durable conventions (framework choices, style, acceptance criteria). */
  userRules?: string;
}

export function buildProjectRules({ project, userRules }: ProjectRulesInput): string {
  const fileList =
    project.files.length === 0
      ? "- (empty — no files created yet)"
      : project.files
          .slice()
          .sort((a, b) => a.path.localeCompare(b.path))
          .map((f) => `- ${f.path} (${f.content.length} bytes)`)
          .join("\n");

  return [
    "# Project context (advisory, refreshed each turn)",
    `Project: ${project.projectName || "(unnamed)"}`,
    project.summary ? `Summary: ${project.summary}` : "",
    "",
    "## Current workspace files",
    fileList,
    userRules ? `\n## Project conventions\n${userRules}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
