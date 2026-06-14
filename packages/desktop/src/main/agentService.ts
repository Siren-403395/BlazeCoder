/**
 * Owns ONE AgentRuntime (one project at a time) and brokers the renderer's IPC calls to
 * it. This is where the SEMANTIC invariants live that structural validation cannot:
 *   - single-flight: one run at a time, and never while a permission is outstanding;
 *   - permission liveness: only resolve a requestId that belongs to the CURRENT run;
 *   - clean teardown: an abort or a run error DRAINS any parked permission and tells the
 *     renderer, so a stuck modal can never strand the UI or resolve a torn-down loop.
 *
 * The runtime wiring (buildRuntime/loadConfig) comes from @zephyrcode/host — the same
 * wiring the TUI uses, which is what makes the GUI a true sibling adapter.
 */

import { statSync } from "node:fs";
import { resolve } from "node:path";
import { buildRuntime, loadConfig } from "@zephyrcode/host";
import type { AgentRuntime } from "@zephyrcode/core";
import type { AgentEvent, SessionState, SessionSummary } from "@zephyrcode/shared";
import type {
  CompactResult,
  DesktopProject,
  DesktopRunRequest,
  DesktopRunResult,
  PermissionDecisionRequest,
} from "../shared/ipc";

type EmitToRenderer = (event: AgentEvent) => void;

interface PendingPermission {
  suggestions: string[];
}

export class AgentService {
  private runtime: AgentRuntime | undefined;
  private project: DesktopProject | undefined;
  private activeSessionId: string | undefined;
  private runAbort: AbortController | undefined;
  private compactAbort: AbortController | undefined;
  private readonly pendingPermissions = new Map<string, PendingPermission>();

  constructor(private readonly emitToRenderer: EmitToRenderer) {}

  openProject(cwdInput: string): DesktopProject {
    const cwd = resolve(cwdInput);
    const stat = statSync(cwd); // throws for a bogus path — surfaced to the renderer
    if (!stat.isDirectory()) throw new Error(`Not a directory: ${cwd}`);

    // Tear down anything in flight on the previous project before switching.
    this.abort();
    this.compactAbort?.abort();

    const config = loadConfig(cwd);
    this.runtime = buildRuntime(config, cwd);
    this.project = {
      cwd: this.runtime.cwd,
      model: this.runtime.model,
      permissionMode: this.runtime.permissionMode,
    };
    this.activeSessionId = undefined;
    this.pendingPermissions.clear();
    return this.project;
  }

  getProject(): DesktopProject | undefined {
    return this.project;
  }

  async run(request: DesktopRunRequest): Promise<DesktopRunResult> {
    const runtime = this.requireRuntime();
    if (this.runAbort) throw new Error("An agent run is already active.");
    if (this.pendingPermissions.size > 0) throw new Error("Resolve the pending permission request first.");
    const prompt = request.prompt.trim();
    if (!prompt) throw new Error("Prompt is empty.");

    const abort = new AbortController();
    this.runAbort = abort;
    const sessionId = request.sessionId ?? this.activeSessionId;

    try {
      const outcome = await runtime.run(
        { prompt, sessionId, effort: request.effort },
        (event) => this.emit(event),
        abort.signal,
      );
      this.activeSessionId = outcome.session.id;
      return {
        sessionId: outcome.session.id,
        subtype: outcome.result.subtype,
        summary: outcome.result.summary,
      };
    } catch (error) {
      this.emit({ type: "notice", level: "error", message: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      this.runAbort = undefined;
      // A finished run (success, error, or abort) cannot have a live permission prompt.
      this.drainPendingPermissions();
    }
  }

  abort(): boolean {
    if (!this.runAbort) return false;
    this.runAbort.abort();
    // Don't wait for the loop to unwind: clear any parked permission now so the renderer's
    // modal closes immediately and the UI returns to idle.
    this.drainPendingPermissions();
    return true;
  }

  resolvePermission(request: PermissionDecisionRequest): boolean {
    const runtime = this.requireRuntime();
    const pending = this.pendingPermissions.get(request.requestId);
    if (!pending) return false; // stale/unknown id — never resolve a torn-down or foreign request
    if (request.behavior === "allow" && request.persist && pending.suggestions.length) {
      runtime.persistPermission({
        type: "addRules",
        behavior: "allow",
        rules: pending.suggestions,
        destination: request.persist,
      });
    }
    const resolved = runtime.resolvePermission(request.requestId, {
      behavior: request.behavior,
      message: request.behavior === "deny" ? "Denied from the desktop workbench." : undefined,
    });
    if (resolved) this.pendingPermissions.delete(request.requestId);
    return resolved;
  }

  listSessions(): Promise<SessionSummary[]> {
    return this.requireRuntime().listSessions();
  }

  getSession(id: string): Promise<SessionState | undefined> {
    return this.requireRuntime().getSession(id);
  }

  async compact(sessionId: string | undefined): Promise<CompactResult> {
    const runtime = this.requireRuntime();
    const abort = new AbortController();
    this.compactAbort = abort;
    try {
      const result = await runtime.compact(sessionId ?? this.activeSessionId, (event) => this.emit(event), abort.signal);
      return { status: result.status, tokensBefore: result.tokensBefore, tokensAfter: result.tokensAfter };
    } finally {
      this.compactAbort = undefined;
    }
  }

  private emit(event: AgentEvent): void {
    if (event.type === "system") this.activeSessionId = event.sessionId;
    if (event.type === "result") this.activeSessionId = event.sessionId;
    if (event.type === "permission_request") {
      this.pendingPermissions.set(event.requestId, { suggestions: event.suggestions ?? [] });
    }
    this.emitToRenderer(event);
  }

  private drainPendingPermissions(): void {
    if (this.pendingPermissions.size === 0) return;
    this.pendingPermissions.clear();
    this.emitToRenderer({ type: "notice", level: "info", message: "Pending permission request was cleared." });
  }

  private requireRuntime(): AgentRuntime {
    if (!this.runtime) throw new Error("Open a project before running zephyrcode.");
    return this.runtime;
  }
}
