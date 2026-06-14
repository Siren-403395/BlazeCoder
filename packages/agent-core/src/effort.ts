/**
 * Reasoning "effort" — the CLI affordance the old deep-thinking toggle became.
 * It controls ONLY DeepSeek-V4-Pro's reasoning DEPTH (its three native thinking modes).
 * It does NOT touch the output-token budget: output is unleashed to the model's maximum
 * (see `outputBudget`), reduced only when the context window physically can't hold it.
 *
 *   low   -> Non-think   (thinking off)
 *   high  -> Think High  (thinking on, budget "high")
 *   ultra -> Think Max   (thinking on, budget "max" — deepest reasoning)
 *
 * It is a sticky session setting plus a per-turn "ultrathink" keyword escalation.
 */

export type Effort = "low" | "high" | "ultra";

export const EFFORTS: Effort[] = ["low", "high", "ultra"];

/** DeepSeek-V4-Pro thinking depth: "high" = Think High, "max" = Think Max. */
export type ThinkingBudget = "high" | "max";

export function isEffort(value: string): value is Effort {
  return (EFFORTS as string[]).includes(value);
}

export interface ResolvedEffort {
  /** Whether deep-thinking mode is on at all. */
  thinking: boolean;
  /** Native reasoning depth when thinking is on. */
  budget?: ThinkingBudget;
}

/** Map an effort level to DeepSeek-V4-Pro's thinking knobs (depth only — never output). */
export function resolveEffort(effort: Effort = "high"): ResolvedEffort {
  switch (effort) {
    case "low":
      return { thinking: false };
    case "high":
      return { thinking: true, budget: "high" };
    case "ultra":
      return { thinking: true, budget: "max" };
  }
}

/**
 * DeepSeek-V4-Pro's hard maximum output per request: 384K tokens (the model also has a
 * ~1M-token context window). This is the ceiling we let output reach — we never cap below it.
 */
export const MODEL_MAX_OUTPUT_TOKENS = 384_000;

/**
 * The output-token budget (`max_tokens`) for a single request. We hand the model its FULL
 * maximum and only shrink it when the input is large enough that input + output would
 * overflow the context window — so output is unleashed (up to 384K when there's room)
 * rather than pinned to a small fixed cap. `cap` lets a caller lower the ceiling (e.g. for
 * cost control) and defaults to the model max; `pad` is framing/estimate headroom.
 */
export function outputBudget(
  contextTokens: number,
  inputTokens: number,
  cap: number = MODEL_MAX_OUTPUT_TOKENS,
  pad = 8_000,
): number {
  const room = contextTokens - inputTokens - pad;
  return Math.max(1_024, Math.min(cap, room));
}

const ESCALATE_RE = /\b(ultrathink|think (?:harder|hard|more|deeply|a lot|step by step))\b/i;

/**
 * Per-turn escalation: a "ultrathink" / "think hard(er)" hint in the prompt bumps
 * THIS turn to ultra, overriding the sticky setting (it must never be silently
 * ignored). Returns the effort to use for the turn.
 */
export function escalateFromPrompt(text: string, sticky: Effort): Effort {
  return ESCALATE_RE.test(text) ? "ultra" : sticky;
}
