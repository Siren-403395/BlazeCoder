/**
 * Wire a CLI config into an in-process AgentRuntime: the real Node/OS adapters
 * (DeepSeek gateway, file-backed session + memory stores, real filesystem
 * workspace) behind the portable kernel. A missing API key (or AGENT_FAKE_MODEL)
 * falls back to the offline stub so `ca` still boots.
 */

import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  builtinTools,
  createAgentRuntime,
  FileMemoryStore,
  FileSessionStore,
  loadAgentDefinitions,
  loadLayeredSettings,
  loadOutputStyles,
  loadSkills,
  makeSkillTool,
  silentLogger,
  systemClock,
  webTools,
} from "@blazecoder/core";
import { HttpWebClient } from "./adapters/webClient";
import type { AgentRuntime, Logger, PermissionMode, RuleSource } from "@blazecoder/core";
import { StubGateway } from "./adapters/stubGateway";
import { LocalProcessSandbox } from "./adapters/sandbox";
import { resolveProvider } from "./providers";
import type { CliConfig } from "./config";
import { projectStateDir, settingsPaths } from "./projects";
import { hooksDisabled, isWorkspaceTrusted, readHooks } from "./settings";
import { postToolUseHooksFrom, preToolUseHooksFrom } from "./adapters/commandHook";

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
  // The gateway is built through the provider registry, so swapping/adding a model
  // backend is one provider file — the runtime stays provider-agnostic. A missing key
  // (or AGENT_FAKE_MODEL) falls back to the offline stub so the agent still boots.
  const gateway =
    config.fakeModel || !config.apiKey
      ? new StubGateway()
      : resolveProvider(config.providerId).createGateway(
          { apiKey: config.apiKey, baseUrl: config.baseUrl },
          { model: config.model, maxRetries: config.maxRetries },
        );

  // Sessions + agent memory are PER-PROJECT: rooted in this workspace's own
  // state dir, never the shared home. (The API key in config.json stays global.)
  const root = canonical(cwd);
  const projectDir = projectStateDir(config.home, root);

  // Permission settings, by contrast, live IN the working dir so they travel with
  // the repo (user scope is global). Source-relative path globs root at: user→home,
  // project/local→the workspace root.
  const paths = settingsPaths(config.home, root);
  const settings = loadLayeredSettings(paths);
  const sourceRootDir = (source: RuleSource): string | undefined =>
    source === "user" ? config.home : source === "project" || source === "local" ? root : undefined;

  // Settings-driven command hooks run arbitrary shell, so PROJECT/LOCAL hooks load
  // ONLY for a trusted workspace; the user (home) scope is implicitly trusted. The
  // BLAZECODER_DISABLE_HOOKS env var is a global kill switch.
  const trusted = isWorkspaceTrusted(projectDir);
  const hookConfigs = hooksDisabled()
    ? []
    : [readHooks(paths.user), ...(trusted ? [readHooks(paths.project), readHooks(paths.local)] : [])];
  const extraPreToolUseHooks = hookConfigs.flatMap(preToolUseHooksFrom);
  const extraPostToolUseHooks = hookConfigs.flatMap(postToolUseHooksFrom);

  // Custom sub-agents: user-scope always; project-scope only for a trusted workspace.
  const agentDirs = [join(config.home, "agents"), ...(trusted ? [join(root, ".blazecoder", "agents")] : [])];
  const { definitions: agents } = loadAgentDefinitions(agentDirs, builtinTools().map((t) => t.name));

  // Skills (same trust gate). When any exist, expose the model-callable Skill tool.
  const skillDirs = [join(config.home, "skills"), ...(trusted ? [join(root, ".blazecoder", "skills")] : [])];
  const skills = loadSkills(skillDirs);
  const extraTools = [
    ...(skills.length ? [makeSkillTool(skills)] : []),
    ...(config.webEnabled ? webTools(new HttpWebClient()) : []),
  ];

  // Output styles (same trust gate): the runtime owns the active style so /output-style
  // can switch it at runtime. config.outputStyle selects the one active at startup.
  const styleDirs = [join(config.home, "output-styles"), ...(trusted ? [join(root, ".blazecoder", "output-styles")] : [])];
  const styles = loadOutputStyles(styleDirs);

  return createAgentRuntime({
    gateway,
    sessionStore: new FileSessionStore(projectDir, systemClock),
    memory: new FileMemoryStore(join(projectDir, "memory")),
    sandbox: new LocalProcessSandbox(),
    cwd: root,
    logger: opts.logger ?? silentLogger,
    permissionMode: opts.permissionMode ?? settings.defaultMode,
    rules: settings.rules,
    sourceRootDir,
    settingsFiles: { user: paths.user, project: paths.project, local: paths.local },
    // Spill oversized tool output inside the workspace so the agent can Read it back.
    spillDir: join(root, ".blazecoder", "tool-results"),
    extraPreToolUseHooks,
    extraPostToolUseHooks,
    extraTools,
    skills,
    outputStyles: styles,
    outputStyle: config.outputStyle,
    agents,
    maxTurns: config.maxTurns,
    maxBudgetUsd: config.maxBudgetUsd,
    contextTokens: config.contextTokens,
    maxOutputTokens: config.maxOutputTokens,
  });
}
