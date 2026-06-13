/**
 * Session context assembly + token accounting. The context window is the primary
 * scarce resource, so this module is the single place that turns a session's
 * transcript into a model request and estimates its token cost. Project rules are
 * injected as a fresh synthetic user message each turn (advisory; reflects the
 * live workspace) — Claude Code's "memory as a user message after the system
 * prompt" pattern.
 */

import type { GeneratedProject } from "@coding-agent/shared";
import type { ModelRequest, ToolSchema, TranscriptMessage } from "../ports";
import { buildProjectRules } from "../memory/projectRules";

/** Cheap heuristic (~4 chars/token). Swap for a real tokenizer behind this fn later. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface AssembleParams {
  system: string;
  project: GeneratedProject;
  userRules?: string;
  messages: TranscriptMessage[];
  tools: ToolSchema[];
  maxOutputTokens?: number;
  temperature?: number;
}

export function assembleRequest(params: AssembleParams): ModelRequest {
  const rules = buildProjectRules({ project: params.project, userRules: params.userRules });
  const messages: TranscriptMessage[] = [{ role: "user", content: rules }, ...params.messages];
  return {
    system: params.system,
    messages,
    tools: params.tools,
    maxOutputTokens: params.maxOutputTokens,
    temperature: params.temperature,
  };
}

export function estimateRequestTokens(request: ModelRequest): number {
  let total = estimateTokens(request.system);
  for (const tool of request.tools) {
    total += estimateTokens(tool.name + tool.description + JSON.stringify(tool.inputSchema));
  }
  for (const message of request.messages) {
    total += estimateMessageTokens(message);
  }
  return total;
}

export function estimateMessageTokens(message: TranscriptMessage): number {
  switch (message.role) {
    case "user":
    case "summary":
      return estimateTokens(message.content);
    case "assistant":
      return (
        estimateTokens(message.content) +
        message.toolCalls.reduce((sum, c) => sum + estimateTokens(c.name + JSON.stringify(c.input)), 0)
      );
    case "tool":
      return message.results.reduce((sum, r) => sum + estimateTokens(r.content), 0);
  }
}

export interface Budget {
  totalTokens: number;
  usedTokens: number;
  remainingTokens: number;
}

export function computeBudget(contextTokens: number, usedTokens: number): Budget {
  return {
    totalTokens: contextTokens,
    usedTokens,
    remainingTokens: Math.max(0, contextTokens - usedTokens),
  };
}
