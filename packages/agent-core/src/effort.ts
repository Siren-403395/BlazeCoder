/**
 * Reasoning "effort" — the CLI affordance the old deep-thinking toggle became.
 * It is a sticky session setting plus a per-turn keyword escalation, and it maps
 * to two model knobs the gateway already understands: whether thinking mode is
 * enabled, and the output-token budget.
 *
 * DeepSeek V4's OpenAI-compatible endpoint exposes thinking as an on/off flag
 * (no granular budget), so the medium/high/ultra gradient is approximated with
 * the output-token ceiling. This is intentional and documented here rather than
 * pretending the API has a budget parameter it does not.
 */

export type Effort = "low" | "medium" | "high" | "ultra";

export const EFFORTS: Effort[] = ["low", "medium", "high", "ultra"];

export function isEffort(value: string): value is Effort {
  return (EFFORTS as string[]).includes(value);
}

/** Map an effort level to the model knobs: thinking on/off + output-token budget. */
export function resolveEffort(effort: Effort = "high", baseMaxOutputTokens = 8000): {
  thinking: boolean;
  maxOutputTokens: number;
} {
  switch (effort) {
    case "low":
      return { thinking: false, maxOutputTokens: baseMaxOutputTokens };
    case "medium":
      return { thinking: true, maxOutputTokens: baseMaxOutputTokens };
    case "high":
      return { thinking: true, maxOutputTokens: Math.round(baseMaxOutputTokens * 1.5) };
    case "ultra":
      return { thinking: true, maxOutputTokens: baseMaxOutputTokens * 2 };
  }
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
