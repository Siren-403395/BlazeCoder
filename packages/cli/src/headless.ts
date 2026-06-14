/**
 * Headless mode (`ca -p "<prompt>"`) — run one prompt non-interactively and write
 * to stdout, for scripting and CI. No Ink, so there is no Yoga startup cost and
 * output is pipeable. Three formats: text (assistant prose to stdout, tool
 * activity to stderr), json (a single final result object), and stream-json
 * (one AgentEvent per line). Permission prompts are auto-denied unless the
 * runtime was built in bypass mode (--yolo), since nobody can answer them.
 */

import type { AgentEvent } from "@zephyrcode/shared";
import type { AgentRuntime, Effort } from "@zephyrcode/core";
import { toolDetail } from "./tui/theme";

export type OutputFormat = "text" | "json" | "stream-json";

export interface HeadlessOptions {
  prompt: string;
  effort: Effort;
  format: OutputFormat;
  sessionId?: string;
  /** Where to write (defaults to process.std*). Injectable for tests. */
  out?: { write(s: string): void };
  err?: { write(s: string): void };
}

/** Run a single prompt headlessly. Returns a process exit code (0 = success). */
export async function runHeadless(runtime: AgentRuntime, opts: HeadlessOptions): Promise<number> {
  const out = opts.out ?? process.stdout;
  const err = opts.err ?? process.stderr;
  const format = opts.format;

  const emit = (e: AgentEvent) => {
    // Nobody can answer a prompt headlessly; deny so the loop continues instead of hanging.
    if (e.type === "permission_request") {
      runtime.resolvePermission(e.requestId, { behavior: "deny", message: "Headless run: permission denied (use --yolo to allow)." });
    }

    if (format === "stream-json") {
      out.write(`${JSON.stringify(e)}\n`);
      return;
    }
    if (format === "text") {
      if (e.type === "assistant" && e.text) out.write(`${e.text}\n`);
      else if (e.type === "tool_call") err.write(`· ${e.name} ${toolDetail(e.name, e.input)}\n`);
      // tool_result fires on both the streaming and non-streaming paths (one per tool).
      else if (e.type === "tool_result") err.write(`${e.isError ? "✘" : "✔"} ${e.name}\n`);
      else if (e.type === "notice" && e.level === "error") err.write(`! ${e.message}\n`);
    }
  };

  const { result } = await runtime.run(
    { prompt: opts.prompt, effort: opts.effort, sessionId: opts.sessionId },
    emit,
    new AbortController().signal,
  );

  if (format === "json") {
    out.write(
      `${JSON.stringify(
        {
          subtype: result.subtype,
          sessionId: result.sessionId,
          numTurns: result.numTurns,
          costUsd: result.totalCostUsd,
          usage: result.usage,
          summary: result.summary,
        },
        null,
        2,
      )}\n`,
    );
  }

  return result.subtype === "success" ? 0 : 1;
}
