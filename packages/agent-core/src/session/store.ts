/**
 * SessionStore implementations. Sessions persist the CONVERSATION + the project
 * snapshot (file undo / checkpointing is a separate concern, deferred). Any
 * worker can run a session because state lives behind this port.
 */

import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Clock, SessionState, SessionStore, SessionSummary } from "../ports";

type CreateInit = Parameters<SessionStore["create"]>[0];

function newSession(init: CreateInit, now: number): SessionState {
  return {
    id: init.id,
    createdAt: now,
    updatedAt: now,
    model: init.model,
    title: init.title || "Untitled session",
    messages: [],
    cwd: init.cwd,
    turns: 0,
    costUsd: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    status: "idle",
  };
}

function toSummary(state: SessionState): SessionSummary {
  return {
    id: state.id,
    title: state.title,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    turns: state.turns,
    cwd: state.cwd,
  };
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionState>();

  constructor(private readonly clock: Clock) {}

  async create(init: CreateInit): Promise<SessionState> {
    const state = newSession(init, this.clock.now());
    this.sessions.set(state.id, state);
    return structuredClone(state);
  }

  async get(id: string): Promise<SessionState | undefined> {
    const found = this.sessions.get(id);
    return found ? structuredClone(found) : undefined;
  }

  async save(state: SessionState): Promise<void> {
    state.updatedAt = this.clock.now();
    this.sessions.set(state.id, structuredClone(state));
  }

  async list(): Promise<SessionSummary[]> {
    return [...this.sessions.values()].map(toSummary).sort((a, b) => b.updatedAt - a.updatedAt);
  }
}

export class FileSessionStore implements SessionStore {
  private readonly dir: string;

  constructor(
    dataDir: string,
    private readonly clock: Clock,
  ) {
    this.dir = resolve(dataDir, "sessions");
  }

  private file(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  async create(init: CreateInit): Promise<SessionState> {
    const state = newSession(init, this.clock.now());
    await this.save(state);
    return state;
  }

  async get(id: string): Promise<SessionState | undefined> {
    try {
      return JSON.parse(await readFile(this.file(id), "utf8")) as SessionState;
    } catch {
      return undefined;
    }
  }

  async save(state: SessionState): Promise<void> {
    state.updatedAt = this.clock.now();
    await mkdir(this.dir, { recursive: true });
    // Atomic write: a process killed mid-save leaves EITHER the old file or the new one
    // intact, never a truncated half-file (a corrupt file would otherwise break list()).
    const target = this.file(state.id);
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    await rename(tmp, target);
  }

  async list(): Promise<SessionSummary[]> {
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch {
      return []; // no sessions dir yet
    }
    // Best-effort sweep of orphaned temp files from a crash between write and rename. Skip
    // our own in-flight tmp (same pid), and fire-and-forget so a delete error never hides
    // sessions or blocks the listing.
    for (const f of entries) {
      if (f.endsWith(".tmp") && !f.endsWith(`.${process.pid}.tmp`)) {
        void rm(join(this.dir, f), { force: true }).catch(() => {});
      }
    }
    const files = entries.filter((f) => f.endsWith(".json"));
    // Parse each file INDEPENDENTLY: one corrupt/partial session must not hide the rest
    // (the old Promise.all rejected the whole listing on a single bad file → "all gone").
    const states = await Promise.all(
      files.map(async (f): Promise<SessionState | null> => {
        try {
          return JSON.parse(await readFile(join(this.dir, f), "utf8")) as SessionState;
        } catch {
          return null;
        }
      }),
    );
    return states
      .filter((s): s is SessionState => s !== null)
      .map(toSummary)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
}
