/**
 * Reasoning "effort" — the CLI affordance the old deep-thinking toggle became.
 * It is a sticky session setting plus a per-turn keyword escalation, and it maps
 * directly onto DeepSeek-V4-Pro's THREE native reasoning modes:
 *
 *   low   -> Non-think   (thinking off)
 *   high  -> Think High  (thinking on, budget "high" — structured, fixed budget)
 *   ultra -> Think Max   (thinking on, budget "max"  — unlimited reasoning budget)
 *
 * Earlier DeepSeek models only exposed thinking on/off, so this used to fake a
 * gradient with the output-token ceiling. V4-Pro added a real `thinking.budget`
 * knob, so we drive that instead; the output-token ceiling is now only a guard
 * against truncation (Think Max can emit very long chains of thought).
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
  /** Output-token ceiling (a truncation guard, not the depth lever). */
  maxOutputTokens: number;
}

/** Map an effort level to DeepSeek-V4-Pro's thinking knobs + an output ceiling. */
export function resolveEffort(effort: Effort = "high", baseMaxOutputTokens = 8000): ResolvedEffort {
  switch (effort) {
    case "low":
      return { thinking: false, maxOutputTokens: baseMaxOutputTokens };
    case "high":
      return { thinking: true, budget: "high", maxOutputTokens: Math.round(baseMaxOutputTokens * 1.5) };
    case "ultra":
      return { thinking: true, budget: "max", maxOutputTokens: baseMaxOutputTokens * 2 };
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
