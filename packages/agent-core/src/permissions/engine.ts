/**
 * Permission engine — ordered gates: hooks → protected-paths → deny → mode →
 * allow → human callback (ask). Returns ALLOW or DENY only; "ask" is resolved
 * inside the engine by emitting a permission_request and awaiting the human
 * decision through the PermissionBroker.
 */

import type { EventSink } from "../ports";
import type { Tool } from "../tools/registry";
import { HookBus } from "./hooks";
import { isProtectedPath } from "./protectedPaths";

export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

export type PermissionDecision =
  | { behavior: "allow"; input: Record<string, unknown> }
  | { behavior: "deny"; message: string };

export interface BrokerDecision {
  behavior: "allow" | "deny";
  updatedInput?: Record<string, unknown>;
  message?: string;
}

/** Bridges the in-loop "ask" gate to an out-of-band HTTP decision endpoint. */
export class PermissionBroker {
  private readonly pending = new Map<string, (d: BrokerDecision) => void>();

  request(requestId: string, signal?: AbortSignal): Promise<BrokerDecision> {
    return new Promise<BrokerDecision>((resolve) => {
      this.pending.set(requestId, resolve);
      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            if (this.pending.delete(requestId)) {
              resolve({ behavior: "deny", message: "Run cancelled." });
            }
          },
          { once: true },
        );
      }
    });
  }

  resolve(requestId: string, decision: BrokerDecision): boolean {
    const resolver = this.pending.get(requestId);
    if (!resolver) return false;
    this.pending.delete(requestId);
    resolver(decision);
    return true;
  }

  pendingIds(): string[] {
    return [...this.pending.keys()];
  }
}

const EDIT_TOOLS = new Set(["write_file", "edit_file", "delete_file", "memory"]);

export interface PermissionEngineOptions {
  mode?: PermissionMode;
  /** Tool names always allowed (skip mode gating). */
  allow?: string[];
  /** Tool names always denied. */
  deny?: string[];
  hookBus: HookBus;
  broker: PermissionBroker;
  idGen: () => string;
}

export class PermissionEngine {
  private readonly mode: PermissionMode;
  private readonly allow: Set<string>;
  private readonly deny: Set<string>;
  private readonly hookBus: HookBus;
  private readonly broker: PermissionBroker;
  private readonly idGen: () => string;

  constructor(opts: PermissionEngineOptions) {
    this.mode = opts.mode ?? "default";
    this.allow = new Set(opts.allow ?? []);
    this.deny = new Set(opts.deny ?? []);
    this.hookBus = opts.hookBus;
    this.broker = opts.broker;
    this.idGen = opts.idGen;
  }

  async check(
    tool: Tool,
    input: Record<string, unknown>,
    run: { emit: EventSink; signal: AbortSignal },
  ): Promise<PermissionDecision> {
    // 1) Hooks (can deny / ask / decisively allow).
    const hook = await this.hookBus.runPreToolUse({ toolName: tool.name, input, tool });
    if (hook.decision === "deny") return { behavior: "deny", message: hook.message };
    let effectiveInput = input;
    let forceAsk = false;
    let askReason = `Allow ${tool.name}?`;
    if (hook.decision === "allow") {
      return { behavior: "allow", input: hook.updatedInput ?? input };
    }
    if (hook.decision === "ask") {
      forceAsk = true;
      askReason = hook.reason;
    }

    // 2) Protected paths (never auto-approved except bypass).
    const targetPath = typeof input.path === "string" ? input.path : undefined;
    if (targetPath && isProtectedPath(targetPath) && this.mode !== "bypassPermissions") {
      return { behavior: "deny", message: `Path is protected and cannot be modified: ${targetPath}` };
    }

    // 3) Explicit deny rules.
    if (this.deny.has(tool.name)) {
      return { behavior: "deny", message: `Tool "${tool.name}" is denied by policy.` };
    }

    // 4) Mode disposition (+ explicit allow rules).
    let disposition: "allow" | "ask" | "deny" = forceAsk
      ? "ask"
      : this.modeDisposition(tool);
    if (this.allow.has(tool.name) && disposition !== "deny") disposition = "allow";

    if (disposition === "allow") return { behavior: "allow", input: effectiveInput };
    if (disposition === "deny") {
      return { behavior: "deny", message: `Tool "${tool.name}" is not permitted in ${this.mode} mode.` };
    }

    // 5) Ask the human. Register the pending decision BEFORE emitting so a fast
    //    client response can never race ahead of the awaiting promise.
    const requestId = this.idGen();
    const pending = this.broker.request(requestId, run.signal);
    run.emit({
      type: "permission_request",
      requestId,
      toolName: tool.name,
      input: effectiveInput,
      reason: askReason,
    });
    const decision = await pending;
    if (decision.behavior === "allow") {
      return { behavior: "allow", input: decision.updatedInput ?? effectiveInput };
    }
    return { behavior: "deny", message: decision.message ?? "Denied by user." };
  }

  private modeDisposition(tool: Tool): "allow" | "ask" | "deny" {
    switch (this.mode) {
      case "bypassPermissions":
        return "allow";
      case "plan":
        return tool.readOnly ? "allow" : "deny";
      case "acceptEdits":
        return tool.readOnly || EDIT_TOOLS.has(tool.name) ? "allow" : "ask";
      case "default":
      default:
        return tool.readOnly ? "allow" : "ask";
    }
  }
}
