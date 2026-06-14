/**
 * Owns ONE AgentRuntime (one project at a time) and brokers the renderer's IPC calls to
 * it. This is where the SEMANTIC invariants live that structural validation cannot:
 *   - single-flight: one run at a time, never while a permission is outstanding, never
 *     concurrently with a compaction (both touch the same session file);
 *   - permission liveness: only resolve a requestId that belongs to the CURRENT run;
 *   - generation epoch: an aborted/superseded run (or one preempted by a project switch)
 *     can NEVER mutate shared state or leak its events into the next run — its emits are
 *     dropped, so a trailing `result` can't clobber activeSessionId or the new timeline;
 *   - clean teardown: an abort or a run error drains any parked permission and tells the
 *     renderer, so a stuck modal can never strand the UI.
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
  /** Bumped whenever an in-flight operation is superseded (abort, project switch). An emit
   *  tagged with a stale generation is dropped — it cannot touch state or reach the renderer. */
  private generation = 0;

  constructor(private readonly emitToRenderer: EmitToRenderer) {}

  openProject(cwdInput: string): DesktopProject {
    const cwd = resolve(cwdInput);
    const stat = statSync(cwd); // throws for a bogus path — surfaced to the renderer
    if (!stat.isDirectory()) throw new Error(`Not a directory: ${cwd}`);

    // Tear down anything in flight on the previous project, then advance the generation so the
    // old run's trailing events (the post-abort `result`) cannot leak into the new project.
    this.runAbort?.abort();
    this.compactAbort?.abort();
    this.generation++;
    this.drainPendingPermissions();

    const config = loadConfig(cwd);
    this.runtime = buildRuntime(config, cwd);
    this.runAbort = undefined;
    this.compactAbort = undefined;
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
    if (this.compactAbort) throw new Error("A compaction is in progress.");
    if (this.pendingPermissions.size > 0) throw new Error("Resolve the pending permission request first.");
    const prompt = request.prompt.trim();
    if (!prompt) throw new Error("Prompt is empty.");

    const abort = new AbortController();
    this.runAbort = abort;
    const gen = ++this.generation;
    const sessionId = request.sessionId ?? this.activeSessionId;

    try {
      const outcome = await runtime.run(
        { prompt, sessionId, effort: request.effort },
        (event) => this.emit(event, gen),
        abort.signal,
      );
      // Only adopt the session id if THIS run is still the current one (not superseded by an
      // abort or a project switch while it was unwinding).
      if (gen === this.generation) this.activeSessionId = outcome.session.id;
      return {
        sessionId: outcome.session.id,
        subtype: outcome.result.subtype,
        summary: outcome.result.summary,
      };
    } catch (error) {
      if (gen === this.generation) {
        this.emit({ type: "notice", level: "error", message: error instanceof Error ? error.message : String(error) }, gen);
      }
      throw error;
    } finally {
      if (this.runAbort === abort) this.runAbort = undefined;
      this.drainPendingPermissions();
    }
  }

  abort(): boolean {
    if (!this.runAbort) return false;
    this.runAbort.abort();
    // Supersede the run so its trailing events are dropped, and clear any parked permission now
    // so the renderer's modal closes immediately and the UI returns to idle.
    this.generation++;
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
    if (this.runAbort) throw new Error("An agent run is active.");
    if (this.compactAbort) throw new Error("A compaction is already in progress.");
    const abort = new AbortController();
    this.compactAbort = abort;
    const gen = ++this.generation;
    try {
      const result = await runtime.compact(sessionId ?? this.activeSessionId, (event) => this.emit(event, gen), abort.signal);
      return { status: result.status, tokensBefore: result.tokensBefore, tokensAfter: result.tokensAfter };
    } finally {
      if (this.compactAbort === abort) this.compactAbort = undefined;
    }
  }

  private emit(event: AgentEvent, gen: number): void {
    // Drop everything from a superseded operation: it must not touch state or reach the renderer.
    if (gen !== this.generation) return;
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
