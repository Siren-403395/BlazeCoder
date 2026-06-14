/**
 * @zephyrcode/cli — the locally-installed coding agent: an Ink TUI frontend over the
 * shared Node/OS host wiring (@zephyrcode/host) and the portable agent-core kernel,
 * in-process. No HTTP server; the TUI consumes the AgentRuntime's EventSink directly.
 */

// The Node/OS host wiring (gateway, sandbox, providers, config/settings, runtime,
// headless, onboarding, projects, git) now lives in @zephyrcode/host so the GUI host
// can share it. Re-exported here so existing @zephyrcode/cli consumers and the barrel
// tests keep resolving the same symbols.
export * from "@zephyrcode/host";
export * from "./tui/state";
export * from "./tui/commands";
export { App } from "./tui/App";
export { Onboarding } from "./tui/Onboarding";
