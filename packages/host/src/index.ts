/**
 * @blazecoder/host — the Node/OS host wiring shared by every blazecoder UI host
 * (the Ink TUI today, the Electron GUI next): the model gateway + sandbox adapters,
 * the provider registry, the auth/config/settings loaders, per-project session state,
 * git status, guided onboarding, the headless renderer, and buildRuntime() that
 * assembles them all behind the portable agent-core kernel. It contains NO UI code.
 *
 * A UI host depends on @blazecoder/host (+ core + shared) and never on a sibling host,
 * so the TUI and the GUI are interchangeable adapters over one runtime.
 *
 * `export *` re-exports each module's types AND values while preserving the type-only
 * distinction verbatimModuleSyntax requires.
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
export * from "./git";
export * from "./projects";
