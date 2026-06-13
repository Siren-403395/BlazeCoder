/**
 * Tool executor — runs a turn's tool calls under the permission engine and hook
 * bus, with the parallel-by-mutation gate (read-only concurrent, mutating
 * sequential), per-tool timeouts, and output caps. Defensive: a tool that throws
 * is converted to an isError result so the loop survives and can self-correct.
 */

import type { ToolCall } from "@coding-agent/shared";
import type { Clock } from "../ports";
import type { ToolResultRecord } from "../ports";
import type { PermissionEngine } from "../permissions/engine";
import type { HookBus } from "../permissions/hooks";
import type { Tool, ToolContext, ToolResult } from "./registry";
import type { ToolRegistry } from "./registry";

export interface ToolExecutorOptions {
  maxResultChars?: number;
  defaultTimeoutMs?: number;
}

const DEFAULT_MAX_RESULT_CHARS = 60_000;
const DEFAULT_TIMEOUT_MS = 120_000;

export class ToolExecutor {
  private readonly maxResultChars: number;
  private readonly defaultTimeoutMs: number;

  constructor(
    private readonly registry: ToolRegistry,
    private readonly permissions: PermissionEngine,
    private readonly hooks: HookBus,
    private readonly clock: Clock,
    opts: ToolExecutorOptions = {},
  ) {
    this.maxResultChars = opts.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Execute all tool calls for one assistant turn, preserving call order in the output. */
  async executeTurn(toolCalls: ToolCall[], ctx: ToolContext): Promise<ToolResultRecord[]> {
    const byId = new Map<string, ToolResultRecord>();
    const readOnly: ToolCall[] = [];
    const mutating: ToolCall[] = [];
    for (const call of toolCalls) {
      const tool = this.registry.get(call.name);
      if (tool?.readOnly) readOnly.push(call);
      else mutating.push(call);
    }

    await Promise.all(
      readOnly.map(async (call) => {
        byId.set(call.id, await this.runOne(call, ctx));
      }),
    );
    for (const call of mutating) {
      byId.set(call.id, await this.runOne(call, ctx));
    }

    return toolCalls.map(
      (call) =>
        byId.get(call.id) ?? {
          toolUseId: call.id,
          toolName: call.name,
          content: "Tool produced no result.",
          isError: true,
        },
    );
  }

  private async runOne(call: ToolCall, ctx: ToolContext): Promise<ToolResultRecord> {
    const started = this.clock.now();
    const run = { emit: ctx.emit, signal: ctx.signal };
    let result: ToolResult;

    const tool = this.registry.get(call.name);
    if (!tool) {
      result = {
        content: `Unknown tool: "${call.name}". Available tools: ${this.registry.names().join(", ")}.`,
        isError: true,
      };
    } else {
      const decision = await this.permissions.check(tool, call.input, run);
      if (decision.behavior === "deny") {
        result = { content: decision.message, isError: true };
      } else {
        result = await this.runHandler(tool, decision.input, ctx);
        result = await this.hooks.runPostToolUse({
          toolName: tool.name,
          input: decision.input,
          result,
        });
      }
    }

    const { content, truncated } = this.cap(result.content);
    const durationMs = this.clock.now() - started;
    run.emit({
      type: "tool_result",
      toolUseId: call.id,
      name: call.name,
      content,
      isError: result.isError ?? false,
      durationMs,
    });
    if (truncated) {
      run.emit({
        type: "notice",
        level: "warn",
        message: `Output of ${call.name} was truncated to ${this.maxResultChars} chars.`,
      });
    }
    return { toolUseId: call.id, toolName: call.name, content, isError: result.isError ?? false };
  }

  private async runHandler(
    tool: Tool,
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    try {
      return await this.withTimeout(tool.execute(input, ctx), this.defaultTimeoutMs);
    } catch (error) {
      return {
        content: `Tool "${tool.name}" failed: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  private cap(content: string): { content: string; truncated: boolean } {
    if (content.length <= this.maxResultChars) return { content, truncated: false };
    const head = content.slice(0, this.maxResultChars);
    return {
      content: `${head}\n…[truncated ${content.length - this.maxResultChars} chars — narrow your query or read a specific range]`,
      truncated: true,
    };
  }
}
