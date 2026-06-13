/**
 * Sandbox adapters. DisabledSandbox is the safe default: model-issued shell
 * commands require hard isolation (container/VM) that this deployment does not
 * provide, so run_command returns an actionable error. A real LocalProcess /
 * container sandbox can be slotted in here without touching the loop.
 */

import type { Sandbox, SandboxResult } from "@coding-agent/core";

export const disabledSandbox: Sandbox = {
  available: false,
  async run(): Promise<SandboxResult> {
    return { stdout: "", stderr: "sandbox disabled", exitCode: 1, timedOut: false };
  },
};
