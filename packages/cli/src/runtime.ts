/**
 * Wire a CLI config into an in-process AgentRuntime: the real Node/OS adapters
 * (DeepSeek gateway, file-backed session + memory stores, real filesystem
 * workspace) behind the portable kernel. A missing API key (or AGENT_FAKE_MODEL)
 * falls back to the offline stub so `ca` still boots.
 */

import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  createAgentRuntime,
  FileMemoryStore,
  FileSessionStore,
  silentLogger,
  systemClock,
} from "@coding-agent/core";
import type { AgentRuntime, Logger, PermissionMode } from "@coding-agent/core";
import { DeepSeekGateway } from "./adapters/deepseekGateway";
import { StubGateway } from "./adapters/stubGateway";
import { LocalProcessSandbox } from "./adapters/sandbox";
import type { CliConfig } from "./config";
import { projectStateDir } from "./projects";

/** Canonicalize a path so the project key matches the workspace root exactly. */
function canonical(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

export interface BuildRuntimeOptions {
  logger?: Logger;
  permissionMode?: PermissionMode;
}

export function buildRuntime(config: CliConfig, cwd: string, opts: BuildRuntimeOptions = {}): AgentRuntime {
  const gateway =
    config.fakeModel || !config.apiKey
      ? new StubGateway()
      : new DeepSeekGateway({ apiKey: config.apiKey, model: config.model, baseUrl: config.baseUrl });

  // Sessions + agent memory are PER-PROJECT: rooted in this workspace's own
  // state dir, never the shared home. (The .env / API key stays global.)
  const root = canonical(cwd);
  const projectDir = projectStateDir(config.home, root);

  return createAgentRuntime({
    gateway,
    sessionStore: new FileSessionStore(projectDir, systemClock),
    memory: new FileMemoryStore(join(projectDir, "memory")),
    sandbox: new LocalProcessSandbox(),
    cwd: root,
    logger: opts.logger ?? silentLogger,
    permissionMode: opts.permissionMode,
    maxTurns: config.maxTurns,
    maxBudgetUsd: config.maxBudgetUsd,
    contextTokens: config.contextTokens,
  });
}
