/**
 * SessionStore implementations. Sessions persist the CONVERSATION + the project
 * snapshot (file undo / checkpointing is a separate concern, deferred). Any
 * worker can run a session because state lives behind this port.
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { emptyProject } from "@coding-agent/shared";
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
    project: init.project ?? emptyProject(),
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
    await writeFile(this.file(state.id), JSON.stringify(state, null, 2), "utf8");
  }

  async list(): Promise<SessionSummary[]> {
    try {
      const files = (await readdir(this.dir)).filter((f) => f.endsWith(".json"));
      const states = await Promise.all(
        files.map(async (f) => JSON.parse(await readFile(join(this.dir, f), "utf8")) as SessionState),
      );
      return states.map(toSummary).sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }
}
