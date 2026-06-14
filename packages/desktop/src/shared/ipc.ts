/**
 * The IPC contract — the SINGLE source of truth shared by main, preload and renderer.
 * All imports are type-only (erased by verbatimModuleSyntax), so this file leaks no
 * Node or DOM runtime into either side. Request channels are renderer->main `invoke`
 * (Promise); the one push channel (agent:event) is main->renderer `send`.
 */

import type { AgentEvent, PermissionMode, ResultSubtype, RuleSource, SessionState, SessionSummary } from "@blazecoder/shared";

/**
 * Reasoning effort. A literal mirror of @blazecoder/core's Effort: importing the type from
 * core would drag core's node-using source into the renderer compile unit (which carries no
 * node types by design). Structurally identical, so it stays assignable to core's Effort
 * where the main process hands it to the runtime.
 */
export type Effort = "low" | "high" | "ultra";
export const EFFORTS: readonly Effort[] = ["low", "high", "ultra"];

/** The project the GUI is attached to — one AgentRuntime per project. */
export interface DesktopProject {
  cwd: string;
  model: string;
  permissionMode: PermissionMode;
}

export interface DesktopRunRequest {
  prompt: string;
  sessionId?: string;
  effort?: Effort;
}

export interface DesktopRunResult {
  sessionId: string;
  subtype: ResultSubtype;
  summary: string;
}

export interface PermissionDecisionRequest {
  requestId: string;
  behavior: "allow" | "deny";
  /** When allowing, persist the request's suggested rules at this scope. UI scopes only. */
  persist?: RuleSource;
}

export interface CompactResult {
  status: string;
  tokensBefore: number;
  tokensAfter: number;
}

/** The whitelisted surface the preload exposes as `window.blazecoder`. */
export interface DesktopApi {
  openProjectDialog(): Promise<DesktopProject | undefined>;
  openProjectPath(cwd: string): Promise<DesktopProject>;
  getProject(): Promise<DesktopProject | undefined>;
  runAgent(request: DesktopRunRequest): Promise<DesktopRunResult>;
  abortAgent(): Promise<boolean>;
  resolvePermission(request: PermissionDecisionRequest): Promise<boolean>;
  listSessions(): Promise<SessionSummary[]>;
  getSession(id: string): Promise<SessionState | undefined>;
  compactSession(sessionId?: string): Promise<CompactResult>;
  openExternal(url: string): Promise<boolean>;
  /** Subscribe to the agent event stream; returns an unsubscribe fn. */
  onAgentEvent(listener: (event: AgentEvent) => void): () => void;
}

export const IPC = {
  agentEvent: "agent:event",
  openProjectDialog: "project:open-dialog",
  openProjectPath: "project:open-path",
  getProject: "project:get",
  runAgent: "agent:run",
  abortAgent: "agent:abort",
  resolvePermission: "permission:resolve",
  listSessions: "session:list",
  getSession: "session:get",
  compactSession: "session:compact",
  openExternal: "shell:open-external",
} as const;
