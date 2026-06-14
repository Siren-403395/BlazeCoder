/**
 * @zephyrcode/cli — the locally-installed coding agent: an Ink TUI frontend +
 * the Node/OS adapters (model gateway, sandbox) wired to the portable agent-core
 * kernel in-process. No HTTP server; the TUI consumes the AgentRuntime's
 * EventSink directly.
 */

export * from "./adapters/deepseekGateway";
export * from "./adapters/stubGateway";
export * from "./adapters/sandbox";
export * from "./providers";
export * from "./authStore";
export * from "./config";
export * from "./onboarding";
export * from "./runtime";
export * from "./headless";
export * from "./tui/state";
export * from "./tui/commands";
export { App } from "./tui/App";
export { Onboarding } from "./tui/Onboarding";
