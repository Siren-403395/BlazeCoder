/**
 * Sub-agent isolation — the strongest context lever. A sub-agent runs in a FRESH
 * context window (its own ephemeral session + read-ledger) over a workspace, and
 * returns a distilled final message. It cannot nest. Wiring it as a model-callable
 * `task` tool is a deliberate later step; this function is the tested building
 * block. It shares the parent's real Workspace by default so exploration sees the
 * same repo, but with an isolated ledger so read-before-edit state does not leak.
 */

import type { EventSink, SessionState, Workspace } from "../ports";
import { InMemoryWorkspace } from "../workspace/inMemory";
import { ReadLedger } from "../workspace/ledger";
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
  opts: { sink?: EventSink; signal?: AbortSignal; workspace?: Workspace } = {},
): Promise<SubagentRunResult> {
  const now = deps.clock.now();
  const workspace = opts.workspace ?? new InMemoryWorkspace();
  const session: SessionState = {
    id: `subagent-${now}`,
    createdAt: now,
    updatedAt: now,
    model: deps.gateway.model,
    title: "subagent",
    messages: [],
    cwd: workspace.root,
    turns: 0,
    costUsd: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    status: "idle",
  };
  const sink: EventSink = opts.sink ?? (() => {});
  const signal = opts.signal ?? new AbortController().signal;

  // Fresh ledger: the sub-agent must read files itself before editing.
  const result = await runAgentLoop(session, prompt, workspace, { ...deps, ledger: new ReadLedger() }, sink, signal);
  return { text: result.summary, turns: result.numTurns, subtype: result.subtype };
}
