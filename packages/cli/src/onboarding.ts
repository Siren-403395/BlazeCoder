/**
 * Onboarding: how a fresh install gets a provider + model + API key without the
 * user ever hand-editing a file. Two surfaces share this core:
 *   - the TUI first-run gate (Ink; see tui/Onboarding.tsx) — the pretty path,
 *   - `zephyrcode --setup` and install.sh (readline; `runSetup` below) — the script path.
 * Both end by writing the managed config via setActiveProvider().
 */

import { createInterface } from "node:readline";
import { setActiveProvider } from "./authStore";
import { authConfigPath } from "./authStore";
import type { CliConfig } from "./config";
import { defaultModel, PROVIDERS, type Provider } from "./providers";

/** True when the agent has no usable key and isn't in offline-stub mode. */
export function needsOnboarding(config: CliConfig): boolean {
  return !config.fakeModel && !config.apiKey;
}

export interface SetupResult {
  saved: boolean;
  providerId?: string;
  model?: string;
}

/** Injectable IO so the flow is unit-testable without a real terminal. */
export interface SetupIo {
  write(text: string): void;
  /** Ask a question; resolve with the user's line, or null when no input is available. */
  ask(question: string): Promise<string | null>;
  env: NodeJS.ProcessEnv;
}

const TITLE = "Let's connect a model. This is saved once — you won't be asked again.";

async function pick<T>(io: SetupIo, label: string, items: T[], render: (t: T) => string): Promise<T | null> {
  if (items.length <= 1) return items[0] ?? null;
  io.write(`\n${label}\n`);
  items.forEach((it, i) => io.write(`  ${i + 1}) ${render(it)}\n`));
  const line = await io.ask(`Choose 1-${items.length} (default 1): `);
  if (line === null) return items[0]!;
  const n = Number(line.trim());
  return Number.isInteger(n) && n >= 1 && n <= items.length ? items[n - 1]! : items[0]!;
}

/**
 * Run the readline/script onboarding. Provider + model are chosen (auto-skipped when
 * there's only one), then a key is taken from the provider's env var if present, else
 * prompted. A blank key skips setup (the agent runs on the offline stub until configured).
 */
export async function runHeadlessSetup(home: string, io: SetupIo): Promise<SetupResult> {
  io.write(`\n${TITLE}\n`);

  const provider = await pick<Provider>(io, "Model provider:", PROVIDERS, (p) => p.label);
  if (!provider) {
    io.write("No providers available.\n");
    return { saved: false };
  }
  const model = await pick(io, `${provider.label} model:`, provider.models, (m) => m.label);
  const chosenModel = model ?? defaultModel(provider);

  // Key: the provider's env var wins (non-interactive installs), else prompt.
  let key = (io.env[provider.apiKeyEnv] ?? "").trim();
  if (!key) {
    io.write(`\n${provider.keyHint}\n`);
    for (let attempt = 0; attempt < 3; attempt++) {
      const line = await io.ask(`Paste your ${provider.label} API key (blank to skip): `);
      if (line === null) {
        io.write("No input available; skipping for now — run `zephyrcode --setup` later.\n");
        return { saved: false };
      }
      const candidate = line.trim();
      if (!candidate) {
        io.write("Skipped — running on the offline stub model until you set a key.\n");
        return { saved: false };
      }
      const err = provider.validateKey(candidate);
      if (!err) {
        key = candidate;
        break;
      }
      io.write(`  ${err} Try again.\n`);
    }
    if (!key) {
      io.write("Too many invalid attempts; skipping. Run `zephyrcode --setup` to retry.\n");
      return { saved: false };
    }
  }

  setActiveProvider(home, provider.id, { apiKey: key }, chosenModel.id);
  io.write(`\n✔ Saved ${provider.label} · ${chosenModel.label} → ${authConfigPath(home)}\n`);
  return { saved: true, providerId: provider.id, model: chosenModel.id };
}

/** Build a real stdin/stdout SetupIo backed by readline, and tear it down after `fn`. */
export async function runSetup(home: string): Promise<SetupResult> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const io: SetupIo = {
    write: (t) => process.stdout.write(t),
    // Resolve with the typed/piped line, or null on EOF (closed/empty stdin) so a
    // non-interactive run skips gracefully instead of hanging forever.
    ask: (q) =>
      new Promise<string | null>((res) => {
        let answered = false;
        rl.question(q, (answer) => {
          answered = true;
          res(answer);
        });
        rl.once("close", () => {
          if (!answered) res(null);
        });
      }),
    env: process.env,
  };
  try {
    return await runHeadlessSetup(home, io);
  } finally {
    rl.close();
  }
}
