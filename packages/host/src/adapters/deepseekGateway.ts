/**
 * ModelGateway backed by DeepSeek (OpenAI-compatible chat/completions with tool
 * calling). Translates our provider-agnostic transcript to OpenAI message shape
 * and back, so swapping models is a one-adapter change.
 */

import { randomUUID } from "node:crypto";
import type { StopReason, ToolCall } from "@blazecoder/shared";
import type {
  ModelGateway,
  ModelRequest,
  ModelResponse,
  ModelStreamHandlers,
  TranscriptMessage,
} from "@blazecoder/core";
import { ContextOverflowError } from "@blazecoder/core";
import { HttpError, NonRetryableError, parseRetryAfter, withRetry } from "./withRetry";

const CONTEXT_OVERFLOW_RE = /context length|maximum context|context_length_exceeded|too long|exceeds the maximum/i;

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  /** Thinking-mode reasoning trace; only retained on tool-call turns (V4 requirement). */
  reasoning_content?: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/** A single SSE chunk from the OpenAI-compatible streaming endpoint. */
interface StreamChunk {
  choices?: {
    delta?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number };
}

export interface DeepSeekGatewayOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** USD per 1M tokens; defaults are approximate DeepSeek list prices. */
  pricePerMInput?: number;
  pricePerMOutput?: number;
  /** Max transient-failure retries per model call (default 8). */
  maxRetries?: number;
  /** Abort a stream that stalls for this long with no data (default 90s). */
  idleTimeoutMs?: number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 90_000;

export class DeepSeekGateway implements ModelGateway {
  readonly model: string;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly priceIn: number;
  private readonly priceOut: number;
  private readonly maxRetries: number;
  private readonly idleTimeoutMs: number;

  constructor(opts: DeepSeekGatewayOptions) {
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.endpoint = `${(opts.baseUrl ?? "https://api.deepseek.com").replace(/\/$/, "")}/chat/completions`;
    this.priceIn = opts.pricePerMInput ?? 0.27;
    this.priceOut = opts.pricePerMOutput ?? 1.1;
    this.maxRetries = opts.maxRetries ?? 8;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  }

  private buildBody(request: ModelRequest, stream: boolean): Record<string, unknown> {
    return buildDeepSeekBody(this.model, request, stream);
  }

  private async post(body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // A "too long" 400 becomes a typed ContextOverflowError so the loop can compact + retry.
      if (res.status === 400 && CONTEXT_OVERFLOW_RE.test(detail)) {
        throw new ContextOverflowError(`DeepSeek rejected the request as too long: ${detail.slice(0, 300)}`);
      }
      // Typed so withRetry can decide: 429/5xx retry, 4xx (auth/validation) do not.
      throw new HttpError(res.status, `DeepSeek HTTP ${res.status}: ${detail.slice(0, 500)}`, parseRetryAfter(res.headers.get("retry-after")));
    }
    return res;
  }

  private cost(usage: { inputTokens: number; outputTokens: number }): number {
    return (usage.inputTokens / 1e6) * this.priceIn + (usage.outputTokens / 1e6) * this.priceOut;
  }

  async complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    const body = this.buildBody(request, false);
    return withRetry(
      async () => {
        const res = await this.post(body, signal);
        const data = (await res.json()) as {
          choices?: { message?: OpenAiMessage; finish_reason?: string }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number };
        };
        const choice = data.choices?.[0];
        const message = choice?.message;
        const usage = {
          inputTokens: data.usage?.prompt_tokens ?? 0,
          outputTokens: data.usage?.completion_tokens ?? 0,
          cacheReadTokens: data.usage?.prompt_cache_hit_tokens,
          cacheCreationTokens: data.usage?.prompt_cache_miss_tokens,
        };
        return {
          text: typeof message?.content === "string" ? message.content : "",
          reasoning: typeof message?.reasoning_content === "string" ? message.reasoning_content : undefined,
          toolCalls: parseToolCalls(message?.tool_calls),
          stopReason: mapStopReason(choice?.finish_reason),
          usage,
          costUsd: this.cost(usage),
        };
      },
      { maxRetries: this.maxRetries, signal },
    );
  }

  async stream(request: ModelRequest, signal: AbortSignal, handlers: ModelStreamHandlers): Promise<ModelResponse> {
    const body = this.buildBody(request, true);
    // Retry the connection/HTTP-status phase. If the stream already emitted output
    // before failing, mark it NonRetryable so a retry can't re-emit duplicate text.
    return withRetry(
      async () => {
        let emitted = false;
        const guarded: ModelStreamHandlers = {
          onText: (c) => {
            emitted = true;
            handlers.onText(c);
          },
          onReasoning: (c) => {
            emitted = true;
            handlers.onReasoning(c);
          },
          onToolArgs: (c) => {
            emitted = true; // a mid-stream failure after this must not retry + double-emit
            handlers.onToolArgs?.(c);
          },
          onToolCall: handlers.onToolCall,
        };
        try {
          return await this.readStream(body, signal, guarded);
        } catch (err) {
          if (emitted) throw new NonRetryableError(err);
          throw err;
        }
      },
      { maxRetries: this.maxRetries, signal, onRetry: handlers.onRetry },
    );
  }

  private async readStream(
    body: Record<string, unknown>,
    signal: AbortSignal,
    handlers: ModelStreamHandlers,
  ): Promise<ModelResponse> {
    const res = await this.post(body, signal);
    if (!res.body) throw new Error("DeepSeek streaming response had no body.");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let reasoning = "";
    let finish: string | undefined;
    const usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number } = { inputTokens: 0, outputTokens: 0 };
    // Tool-call fragments arrive keyed by index across many deltas (and the
    // provider does not guarantee they are grouped). Accumulate, then emit each
    // exactly once with complete args after the stream ends.
    const acc = new Map<number, { id: string; name: string; args: string }>();

    // Abort a stream that stalls with no data for idleTimeoutMs — surfaced as a
    // retryable network error (the connection wedged, not the model thinking).
    const readWithIdle = (): Promise<{ done: boolean; value?: Uint8Array }> => {
      let timer: ReturnType<typeof setTimeout>;
      const idle = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const e = new Error(`DeepSeek stream idle for ${this.idleTimeoutMs}ms`) as Error & { code?: string };
          e.code = "ETIMEDOUT";
          reject(e);
        }, this.idleTimeoutMs);
      });
      return Promise.race([reader.read(), idle]).finally(() => clearTimeout(timer));
    };

    try {
      for (;;) {
        const { done, value } = await readWithIdle();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          let chunk: StreamChunk;
          try {
            chunk = JSON.parse(payload) as StreamChunk;
          } catch {
            continue;
          }
          const choice = chunk.choices?.[0];
          const delta = choice?.delta;
          // Reasoning streams on its own channel, ahead of (and separate from) content.
          if (delta?.reasoning_content) {
            reasoning += delta.reasoning_content;
            handlers.onReasoning(delta.reasoning_content);
          }
          if (delta?.content) {
            text += delta.content;
            handlers.onText(delta.content);
          }
          if (Array.isArray(delta?.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const cur = acc.get(idx) ?? { id: "", name: "", args: "" };
              if (tc.id) cur.id = tc.id;
              if (tc.function?.name) cur.name = tc.function.name;
              if (tc.function?.arguments) {
                cur.args += tc.function.arguments;
                // Surface the fragment live so the token gauge climbs while a file body streams.
                handlers.onToolArgs?.(tc.function.arguments);
              }
              acc.set(idx, cur);
            }
          }
          if (choice?.finish_reason) finish = choice.finish_reason;
          if (chunk.usage) {
            usage.inputTokens = chunk.usage.prompt_tokens ?? 0;
            usage.outputTokens = chunk.usage.completion_tokens ?? 0;
            usage.cacheReadTokens = chunk.usage.prompt_cache_hit_tokens;
            usage.cacheCreationTokens = chunk.usage.prompt_cache_miss_tokens;
          }
        }
      }
    } finally {
      // Tear down the body deterministically on completion, error, or abort.
      reader.cancel().catch(() => {});
    }

    const toolCalls = [...acc.entries()].sort((a, b) => a[0] - b[0]).map(([, a]) => toToolCall(a));
    for (const call of toolCalls) handlers.onToolCall(call);

    return {
      text,
      reasoning: reasoning || undefined,
      toolCalls,
      stopReason: mapStopReason(finish),
      usage,
      costUsd: this.cost(usage),
    };
  }
}

/**
 * Build the OpenAI-compatible request body for DeepSeek. Pure (no `this`) so it
 * can be unit-tested directly. Deep-thinking mode is enabled with an optional
 * native depth `budget` (V4-Pro: "high" = Think High, "max" = Think Max); since
 * thinking mode rejects temperature/top_p/penalties, temperature is only sent
 * when thinking is off.
 */
export function buildDeepSeekBody(model: string, request: ModelRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: toOpenAiMessages(request),
    max_tokens: request.maxOutputTokens ?? 8000,
  };
  if (request.thinking) {
    body.thinking = request.thinkingBudget ? { type: "enabled", budget: request.thinkingBudget } : { type: "enabled" };
  } else {
    body.temperature = request.temperature ?? 0.2;
  }
  if (request.tools.length > 0) {
    body.tools = request.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));
    body.tool_choice = "auto";
  }
  if (stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }
  return body;
}

function toToolCall(a: { id: string; name: string; args: string }): ToolCall {
  let input: Record<string, unknown> = {};
  try {
    input = a.args ? (JSON.parse(a.args) as Record<string, unknown>) : {};
  } catch {
    input = {};
  }
  return { id: a.id || randomUUID(), name: a.name, input };
}

function toOpenAiMessages(request: ModelRequest): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: "system", content: request.system }];
  for (const message of request.messages) {
    pushMessage(out, message);
  }
  return collapseAdjacentUsers(out);
}

function pushMessage(out: OpenAiMessage[], message: TranscriptMessage): void {
  switch (message.role) {
    case "user":
      out.push({ role: "user", content: message.content });
      return;
    case "summary":
      out.push({ role: "user", content: `[Summary of earlier conversation]\n${message.content}` });
      return;
    case "assistant": {
      const msg: OpenAiMessage = { role: "assistant", content: message.content || null };
      if (message.toolCalls.length > 0) {
        msg.tool_calls = message.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.input) },
        }));
        // V4 thinking mode requires the reasoning trace be retained on a turn
        // that made tool calls (but never on a plain answer turn).
        if (message.reasoning) msg.reasoning_content = message.reasoning;
      }
      out.push(msg);
      return;
    }
    case "tool":
      for (const result of message.results) {
        out.push({ role: "tool", tool_call_id: result.toolUseId, content: result.content });
      }
      return;
  }
}

/** Merge consecutive user messages (e.g. the injected project rules + the user's prompt). */
function collapseAdjacentUsers(messages: OpenAiMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  for (const msg of messages) {
    const prev = out[out.length - 1];
    if (msg.role === "user" && prev?.role === "user" && !prev.tool_calls) {
      prev.content = `${prev.content ?? ""}\n\n${msg.content ?? ""}`;
    } else {
      out.push(msg);
    }
  }
  return out;
}

function parseToolCalls(raw: OpenAiMessage["tool_calls"]): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  const calls: ToolCall[] = [];
  for (const c of raw) {
    const name = c.function?.name;
    if (!name) continue;
    let input: Record<string, unknown> = {};
    try {
      input = c.function.arguments ? (JSON.parse(c.function.arguments) as Record<string, unknown>) : {};
    } catch {
      input = {};
    }
    calls.push({ id: c.id || randomUUID(), name, input });
  }
  return calls;
}

function mapStopReason(finish: string | undefined): StopReason {
  switch (finish) {
    case "stop":
    case "tool_calls":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "refusal";
    default:
      return null;
  }
}
