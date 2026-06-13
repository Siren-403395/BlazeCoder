/**
 * @coding-agent/cli — the locally-installed coding agent: a TUI frontend + the
 * Node/OS adapters (model gateway, sandbox) that the portable agent-core kernel
 * is wired to in-process. No HTTP server; the TUI consumes the AgentRuntime's
 * EventSink directly.
 *
 * Phase 0 surface: the model adapters. The TUI, config, commands, and bin land
 * in later phases.
 */

export * from "./adapters/deepseekGateway";
export * from "./adapters/stubGateway";
