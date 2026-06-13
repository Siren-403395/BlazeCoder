/**
 * Wire a CLI config into an in-process AgentRuntime: the real Node/OS adapters
 * (DeepSeek gateway, file-backed session + memory stores, real filesystem
 * workspace) behind the portable kernel. A missing API key (or AGENT_FAKE_MODEL)
 * falls back to the offline stub so `ca` still boots.
 */

import { join } from "node:path";
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

export interface BuildRuntimeOptions {
  logger?: Logger;
  permissionMode?: PermissionMode;
}

export function buildRuntime(config: CliConfig, cwd: string, opts: BuildRuntimeOptions = {}): AgentRuntime {
  const gateway =
    config.fakeModel || !config.apiKey
      ? new StubGateway()
      : new DeepSeekGateway({ apiKey: config.apiKey, model: config.model, baseUrl: config.baseUrl });

  return createAgentRuntime({
    gateway,
    sessionStore: new FileSessionStore(config.home, systemClock),
    memory: new FileMemoryStore(join(config.home, "memories")),
    sandbox: new LocalProcessSandbox(),
    cwd,
    logger: opts.logger ?? silentLogger,
    permissionMode: opts.permissionMode,
    maxTurns: config.maxTurns,
    maxBudgetUsd: config.maxBudgetUsd,
    contextTokens: config.contextTokens,
  });
}
