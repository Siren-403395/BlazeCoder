/**
 * Personality for the live region: a pool of whimsical "working" verbs that
 * rotate while the agent runs, and a pool of product tips shown under the prompt.
 *
 * Each run picks a random seed so consecutive turns get a different verb sequence
 * (the word also advances over time within a run), and tips rotate per turn — so
 * the UI never feels like it's stuck repeating one canned string. Selection is a
 * pure function of (seed, step) so it stays deterministic and unit-testable.
 */

export const LOADING_WORDS: string[] = [
  "Cogitating",
  "Pondering",
  "Ruminating",
  "Noodling",
  "Percolating",
  "Marinating",
  "Conjuring",
  "Distilling",
  "Synthesizing",
  "Untangling",
  "Wrangling",
  "Spelunking",
  "Tinkering",
  "Finagling",
  "Mulling",
  "Contemplating",
  "Daydreaming",
  "Philosophizing",
  "Meandering",
  "Calibrating",
  "Orchestrating",
  "Simmering",
  "Whittling",
  "Puzzling",
  "Deliberating",
  "Scheming",
  "Manifesting",
  "Divining",
  "Ideating",
  "Germinating",
  "Incubating",
  "Crystallizing",
  "Reticulating splines",
  "Hatching",
  "Trailblazing",
  "Bushwhacking",
  "Vibing",
  "Channeling",
];

export const TIPS: string[] = [
  "Type @ to pull a file into context — gitignored & secret files stay hidden.",
  "Tab completes a /command and parks the cursor right on its argument.",
  "Press ↑ to recall your previous messages.",
  "/effort ultra unlocks Think Max — exhaustive reasoning for the hardest problems.",
  "/effort low turns thinking off for quick, cheap answers.",
  'Say "ultrathink" in a prompt to push just that one turn to max effort.',
  "/resume reopens a past conversation right where you left off.",
  "/usage shows what you've spent; /context shows how full the window is.",
  "Esc interrupts a running turn; Ctrl+C quits.",
  "blazecoder edits real files and runs real commands in your working directory.",
  "/clear starts a fresh session — the old one stays on disk for /resume.",
  "Markdown in replies is rendered: headings, lists, and highlighted code.",
  "Shift+Enter (or end a line with \\) drops to a new line — write multi-line prompts.",
];

/** A loading verb for the given run seed at the given step (advances over time). */
export function loadingWord(seed: number, step: number): string {
  const i = (((seed + step) % LOADING_WORDS.length) + LOADING_WORDS.length) % LOADING_WORDS.length;
  return LOADING_WORDS[i]!;
}

/** A product tip at the given rotating index. */
export function tipAt(index: number): string {
  const i = ((index % TIPS.length) + TIPS.length) % TIPS.length;
  return TIPS[i]!;
}

/** A fresh seed so each run's verb sequence differs. */
export function freshSeed(): number {
  return Math.floor(Math.random() * LOADING_WORDS.length * 97);
}
