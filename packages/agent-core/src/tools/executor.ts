/**
 * Tool executor — runs a turn's tool calls under the permission engine and hook
 * bus, with the parallel-by-mutation gate (read-only concurrent, mutating
 * sequential), per-tool timeouts, and output caps. Defensive: a tool that throws
 * is converted to an isError result so the loop survives and can self-correct.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

  /**
   * Synthetic results for orphaned tool_use blocks (one per call), so a transcript
   * that ended on an assistant tool-call turn (abort, max-turns, error) stays
   * API-valid: stricter providers reject an assistant tool_use with no tool_result.
   */
  static syntheticResults(calls: ToolCall[], reason = "[Interrupted]"): ToolResultRecord[] {
    return calls.map((c) => ({ toolUseId: c.id, toolName: c.name, content: reason, isError: true }));
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

    let denied = false;
    const tool = this.registry.get(call.name);
    if (!tool) {
      result = {
        content: `Unknown tool: "${call.name}". Available tools: ${this.registry.names().join(", ")}.`,
        isError: true,
      };
    } else {
      const decision = await this.permissions.check(tool, call.input, run);
      if (decision.behavior === "deny") {
        denied = true;
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

    const { content, truncated } = this.cap(result.content, tool, ctx, call.id);
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
    return { toolUseId: call.id, toolName: call.name, content, isError: result.isError ?? false, ...(denied ? { denied: true } : {}) };
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

  /**
   * Cap a tool result at the tool's own limit (or the executor default). On overflow,
   * spill the FULL output to <spillDir>/<id>.txt (when a spillDir is set) and return a
   * head+tail preview with a pointer; otherwise truncate. The tail is preserved so a
   * Bash failure's stderr (the load-bearing signal) survives.
   */
  private cap(content: string, tool: Tool | undefined, ctx: ToolContext, callId: string): { content: string; truncated: boolean } {
    const limit = tool?.maxResultSizeChars ?? this.maxResultChars;
    if (content.length <= limit) return { content, truncated: false };

    const headLen = Math.floor(limit * 0.7);
    const tailLen = limit - headLen;
    const head = content.slice(0, headLen);
    const tail = content.slice(-tailLen);

    let pointer = "narrow your query or read a specific range";
    if (ctx.spillDir) {
      try {
        mkdirSync(ctx.spillDir, { recursive: true });
        const path = join(ctx.spillDir, `${callId}.txt`);
        writeFileSync(path, content);
        pointer = `full output (${content.length} chars) saved to ${path} — read it with Read if you need more`;
      } catch {
        // spill failed → fall back to the truncation pointer
      }
    }
    return {
      content: `${head}\n…[truncated ${content.length - limit} chars; ${pointer}]\n${tail}`,
      truncated: true,
    };
  }
}
