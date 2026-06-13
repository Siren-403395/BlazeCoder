/**
 * ModelGateway backed by DeepSeek (OpenAI-compatible chat/completions with tool
 * calling). Translates our provider-agnostic transcript to OpenAI message shape
 * and back, so swapping models is a one-adapter change. Salvages V1's robust
 * argument parsing.
 */

import { randomUUID } from "node:crypto";
import type { StopReason, ToolCall } from "@coding-agent/shared";
import type {
  ModelGateway,
  ModelRequest,
  ModelResponse,
  ModelStreamHandlers,
  TranscriptMessage,
} from "@coding-agent/core";

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/** A single SSE chunk from the OpenAI-compatible streaming endpoint. */
interface StreamChunk {
  choices?: {
    delta?: {
      content?: string;
      tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface DeepSeekGatewayOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** USD per 1M tokens; defaults are approximate DeepSeek list prices. */
  pricePerMInput?: number;
  pricePerMOutput?: number;
}

export class DeepSeekGateway implements ModelGateway {
  readonly model: string;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly priceIn: number;
  private readonly priceOut: number;

  constructor(opts: DeepSeekGatewayOptions) {
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.endpoint = `${(opts.baseUrl ?? "https://api.deepseek.com").replace(/\/$/, "")}/chat/completions`;
    this.priceIn = opts.pricePerMInput ?? 0.27;
    this.priceOut = opts.pricePerMOutput ?? 1.1;
  }

  private buildBody(request: ModelRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: toOpenAiMessages(request),
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxOutputTokens ?? 8000,
    };
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

  private async post(body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`DeepSeek HTTP ${res.status}: ${detail.slice(0, 500)}`);
    }
    return res;
  }

  private cost(usage: { inputTokens: number; outputTokens: number }): number {
    return (usage.inputTokens / 1e6) * this.priceIn + (usage.outputTokens / 1e6) * this.priceOut;
  }

  async complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    const res = await this.post(this.buildBody(request, false), signal);
    const data = (await res.json()) as {
      choices?: { message?: OpenAiMessage; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = data.choices?.[0];
    const message = choice?.message;
    const usage = {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };
    return {
      text: typeof message?.content === "string" ? message.content : "",
      toolCalls: parseToolCalls(message?.tool_calls),
      stopReason: mapStopReason(choice?.finish_reason),
      usage,
      costUsd: this.cost(usage),
    };
  }

  async stream(
    request: ModelRequest,
    signal: AbortSignal,
    handlers: ModelStreamHandlers,
  ): Promise<ModelResponse> {
    const res = await this.post(this.buildBody(request, true), signal);
    if (!res.body) throw new Error("DeepSeek streaming response had no body.");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let finish: string | undefined;
    const usage = { inputTokens: 0, outputTokens: 0 };
    // Tool-call fragments arrive keyed by index across many deltas (and the
    // provider does not guarantee they are grouped). Accumulate, then emit each
    // exactly once with complete args after the stream ends.
    const acc = new Map<number, { id: string; name: string; args: string }>();

    try {
      for (;;) {
        const { done, value } = await reader.read();
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
              if (tc.function?.arguments) cur.args += tc.function.arguments;
              acc.set(idx, cur);
            }
          }
          if (choice?.finish_reason) finish = choice.finish_reason;
          if (chunk.usage) {
            usage.inputTokens = chunk.usage.prompt_tokens ?? 0;
            usage.outputTokens = chunk.usage.completion_tokens ?? 0;
          }
        }
      }
    } finally {
      // Tear down the body deterministically on completion, error, or abort.
      reader.cancel().catch(() => {});
    }

    const toolCalls = [...acc.entries()].sort((a, b) => a[0] - b[0]).map(([, a]) => toToolCall(a));
    for (const call of toolCalls) handlers.onToolCall(call);

    return { text, toolCalls, stopReason: mapStopReason(finish), usage, costUsd: this.cost(usage) };
  }
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
