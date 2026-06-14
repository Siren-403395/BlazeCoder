/**
 * Session context assembly + token accounting. The context window is the primary
 * scarce resource, so this module is the single place that turns a session's
 * transcript into a model request and estimates its token cost. Project rules are
 * injected as a fresh synthetic user message each turn (advisory; reflects the
 * live workspace) — Claude Code's "memory as a user message after the system
 * prompt" pattern.
 */

import type { ContextBlock } from "@blazecoder/shared";
import type { ModelRequest, ToolSchema, TranscriptMessage } from "../ports";

/**
 * Char-count heuristic for token estimation. Prose is ~4 chars/token, but
 * JSON-dense tool-result content (paths, braces, line numbers) packs closer to
 * ~2 chars/token — counting it at 4 under-estimates ~2× and lets the transcript
 * blow the real window before compaction fires. Callers pass bytesPerToken to
 * pick the right density. The authoritative number is always the server's real
 * input_tokens (SessionState.lastRealInputTokens) when available; this is the
 * pre-first-call fallback. Swap for a real tokenizer behind this fn later.
 */
export function estimateTokens(text: string, bytesPerToken = 4): number {
  return Math.ceil(text.length / bytesPerToken);
}

/** Multiplier applied to the raw char-estimate to cover role/JSON framing overhead the chars miss. */
const ESTIMATE_PAD = 4 / 3;
/** Tool-result content is JSON-dense; count it at ~2 chars/token. */
const TOOL_BYTES_PER_TOKEN = 2;

export interface AssembleParams {
  system: string;
  /** Pre-built environment/rules block, injected as a synthetic user message after the system prompt. */
  projectRules: string;
  messages: TranscriptMessage[];
  tools: ToolSchema[];
  maxOutputTokens?: number;
  temperature?: number;
  thinking?: boolean;
  thinkingBudget?: "high" | "max";
}

export function assembleRequest(params: AssembleParams): ModelRequest {
  const messages: TranscriptMessage[] = params.projectRules
    ? [{ role: "user", content: params.projectRules }, ...params.messages]
    : [...params.messages];
  return {
    system: params.system,
    messages,
    tools: params.tools,
    maxOutputTokens: params.maxOutputTokens,
    temperature: params.temperature,
    thinking: params.thinking,
    thinkingBudget: params.thinkingBudget,
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
  return Math.ceil(total * ESTIMATE_PAD);
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
      // JSON-dense; count at ~2 chars/token so a big Read/Bash dump isn't under-counted.
      return message.results.reduce((sum, r) => sum + estimateTokens(r.content, TOOL_BYTES_PER_TOKEN), 0);
  }
}

/**
 * Per-block token attribution for the `/context` breakdown. Mirrors what
 * estimateRequestTokens sums internally, but RETURNS the split instead of collapsing
 * it to one scalar — so the same padded heuristic that drives compaction also drives
 * the display (no second, divergent estimator). `projectRules` is the combined
 * environment+conventions+memory block (one synthetic user message); when the memory
 * index is known it is split out of that block so memory shows as its own line. The
 * caller passes the RAW session messages (without projectRules prepended) so the
 * rules/memory block is never double-counted against history.
 */
export interface BreakdownParams {
  system: string;
  projectRules: string;
  /** The memory-index section (a substring of projectRules); split out when present. */
  memorySection?: string;
  messages: TranscriptMessage[];
  tools: ToolSchema[];
}

/** Apply the same framing pad estimateRequestTokens uses, so block sums track the real estimate. */
function pad(raw: number): number {
  return Math.ceil(raw * ESTIMATE_PAD);
}

export function computeContextBreakdown(params: BreakdownParams): ContextBlock[] {
  const systemRaw = estimateTokens(params.system);
  const toolsRaw = params.tools.reduce(
    (sum, t) => sum + estimateTokens(t.name + t.description + JSON.stringify(t.inputSchema)),
    0,
  );
  const rulesBlockRaw = estimateTokens(params.projectRules);
  const memoryRaw = params.memorySection ? Math.min(rulesBlockRaw, estimateTokens(params.memorySection)) : 0;
  const rulesRaw = Math.max(0, rulesBlockRaw - memoryRaw);

  let historyRaw = 0;
  let toolResultsRaw = 0;
  for (const m of params.messages) {
    if (m.role === "tool") toolResultsRaw += estimateMessageTokens(m);
    else historyRaw += estimateMessageTokens(m);
  }

  return [
    { kind: "system", tokens: pad(systemRaw) },
    { kind: "tools", tokens: pad(toolsRaw) },
    { kind: "rules", tokens: pad(rulesRaw) },
    { kind: "memory", tokens: pad(memoryRaw) },
    { kind: "history", tokens: pad(historyRaw) },
    { kind: "toolResults", tokens: pad(toolResultsRaw) },
  ];
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
