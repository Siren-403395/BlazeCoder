/**
 * Composition root — builds an AgentRuntime from environment configuration,
 * choosing the real DeepSeek gateway or the deterministic stub (offline / tests).
 */

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  consoleLogger,
  createAgentRuntime,
  FileMemoryStore,
  FileSessionStore,
  systemClock,
} from "@coding-agent/core";
import type { AgentRuntime } from "@coding-agent/core";
import { DeepSeekGateway } from "./adapters/deepseekGateway";
import { StubGateway } from "./adapters/stubGateway";
import { EsbuildPreviewBuilder } from "./adapters/esbuildPreviewBuilder";
import { disabledSandbox } from "./adapters/sandbox";

export function buildRuntimeFromEnv(env: NodeJS.ProcessEnv = process.env): AgentRuntime {
  const dataDir = resolve(env.DATA_DIR ?? ".data");
  const useStub = env.AGENT_FAKE_MODEL === "1" || !env.DEEPSEEK_API_KEY;

  const gateway = useStub
    ? new StubGateway()
    : new DeepSeekGateway({
        apiKey: env.DEEPSEEK_API_KEY as string,
        model: env.DEEPSEEK_MODEL ?? "deepseek-v4-pro",
        baseUrl: env.DEEPSEEK_BASE_URL,
      });

  if (useStub) {
    console.warn(
      "[agent] No DEEPSEEK_API_KEY (or AGENT_FAKE_MODEL=1): using the deterministic stub model. Set DEEPSEEK_API_KEY in .env for the real model.",
    );
  }

  return createAgentRuntime({
    gateway,
    previewBuilder: new EsbuildPreviewBuilder(),
    sessionStore: new FileSessionStore(dataDir, systemClock),
    memory: new FileMemoryStore(resolve(dataDir, "memories")),
    sandbox: disabledSandbox,
    clock: systemClock,
    logger: consoleLogger("agent"),
    idGen: () => randomUUID(),
    contextTokens: Number(env.AGENT_CONTEXT_TOKENS ?? 65536),
    maxTurns: Number(env.AGENT_MAX_TURNS ?? 24),
    maxBudgetUsd: Number(env.AGENT_MAX_BUDGET_USD ?? 1),
  });
}
