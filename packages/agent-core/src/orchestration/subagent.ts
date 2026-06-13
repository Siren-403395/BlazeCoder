/**
 * Sub-agent isolation — the strongest context lever. A sub-agent runs in a FRESH
 * context window (its own ephemeral session + workspace), receives only the
 * prompt string, and returns a distilled final message. It cannot nest. Wiring
 * it as a model-callable `task` tool is a deliberate later step; this function is
 * the tested building block.
 */

import type { GeneratedProject } from "@coding-agent/shared";
import { emptyProject } from "@coding-agent/shared";
import type { EventSink, SessionState } from "../ports";
import { InMemoryWorkspace } from "../workspace";
import { runAgentLoop } from "../loop/agentLoop";
import type { AgentLoopDeps, AgentRunResult } from "../loop/agentLoop";

export interface SubagentRunResult {
  text: string;
  turns: number;
  subtype: AgentRunResult["subtype"];
}

export async function runSubagent(
  prompt: string,
  deps: AgentLoopDeps,
  opts: { sink?: EventSink; signal?: AbortSignal; project?: GeneratedProject } = {},
): Promise<SubagentRunResult> {
  const now = deps.clock.now();
  const session: SessionState = {
    id: `subagent-${now}`,
    createdAt: now,
    updatedAt: now,
    model: deps.gateway.model,
    title: "subagent",
    messages: [],
    project: opts.project ?? emptyProject("subagent"),
    turns: 0,
    costUsd: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    status: "idle",
  };
  const workspace = new InMemoryWorkspace(session.project);
  const sink: EventSink = opts.sink ?? (() => {});
  const signal = opts.signal ?? new AbortController().signal;

  const result = await runAgentLoop(session, prompt, workspace, deps, sink, signal);
  return { text: result.summary, turns: result.numTurns, subtype: result.subtype };
}
