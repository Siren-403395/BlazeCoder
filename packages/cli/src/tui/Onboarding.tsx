/**
 * First-run onboarding, rendered in the TUI before the chat screen. Walks the user
 * through provider → model → API key (the key is masked, pasted, never echoed), then
 * writes the managed config (~/.zephyrcode/config.json) and hands control back via
 * onDone. Steps with a single choice auto-skip, so today (one provider, one model)
 * the user lands straight on the key step. Reusable: a future in-session /login can
 * mount the same component.
 */

import { useCallback, useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { setActiveProvider } from "../authStore";
import { defaultModel, type ModelOption, type Provider } from "../providers";
import { LOGO, LOGO_WIDTH, TAGLINE } from "./banner";
import { theme } from "./theme";

type Step = "provider" | "model" | "key";

function firstStep(provider: Provider, providerCount: number): Step {
  if (providerCount > 1) return "provider";
  if (provider.models.length > 1) return "model";
  return "key";
}

/** A bordered amber panel matching the picker/permission style. */
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        {title}
      </Text>
      {children}
    </Box>
  );
}

function Choices({ items, index, label }: { items: { label: string; hint?: string }[]; index: number; label: string }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.muted}>{label}</Text>
      {items.map((it, i) => {
        const selected = i === index;
        return (
          <Box key={it.label}>
            <Text color={selected ? theme.accent : theme.muted} bold={selected}>
              {(selected ? "❯ " : "  ") + it.label}
            </Text>
            {it.hint ? <Text color={theme.faint}>{`  ${it.hint}`}</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}

export function Onboarding({
  providers,
  home,
  onDone,
}: {
  providers: Provider[];
  home: string;
  /** Called when setup finishes: saved=true if a key was stored, false if skipped. */
  onDone: (saved: boolean) => void;
}) {
  const { exit } = useApp();
  const [provider, setProvider] = useState<Provider>(providers[0]!);
  const [step, setStep] = useState<Step>(() => firstStep(providers[0]!, providers.length));
  const [pIndex, setPIndex] = useState(0);
  const [mIndex, setMIndex] = useState(0);
  const [model, setModel] = useState<ModelOption>(defaultModel(providers[0]!));
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    (chosen: Provider, chosenModel: ModelOption, apiKey: string) => {
      try {
        setActiveProvider(home, chosen.id, { apiKey: apiKey.trim() }, chosenModel.id);
        onDone(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [home, onDone],
  );

  const submitKey = useCallback(() => {
    const trimmed = key.trim();
    if (!trimmed) {
      onDone(false); // skip — fall back to the offline stub until configured
      return;
    }
    const err = provider.validateKey(trimmed);
    if (err) {
      setError(err);
      return;
    }
    save(provider, model, trimmed);
  }, [key, provider, model, save, onDone]);

  useInput((input, k) => {
    if (k.ctrl && input === "c") {
      exit();
      return;
    }

    if (step === "provider") {
      if (k.upArrow) setPIndex((i) => Math.max(0, i - 1));
      else if (k.downArrow) setPIndex((i) => Math.min(providers.length - 1, i + 1));
      else if (k.return) {
        const p = providers[pIndex]!;
        setProvider(p);
        setModel(defaultModel(p));
        setMIndex(0);
        setStep(p.models.length > 1 ? "model" : "key");
      }
      return;
    }

    if (step === "model") {
      if (k.upArrow) setMIndex((i) => Math.max(0, i - 1));
      else if (k.downArrow) setMIndex((i) => Math.min(provider.models.length - 1, i + 1));
      else if (k.return) {
        setModel(provider.models[mIndex]!);
        setStep("key");
      } else if (k.escape && providers.length > 1) setStep("provider");
      return;
    }

    // step === "key"
    if (k.return) {
      submitKey();
      return;
    }
    if (k.escape) {
      onDone(false);
      return;
    }
    if (k.backspace || k.delete) {
      setKey((v) => v.slice(0, -1));
      setError(null);
      return;
    }
    if (k.ctrl || k.meta || !input) return;
    // Accept typed + pasted characters (a paste arrives as one chunk); drop newlines.
    const clean = input.replace(/[\r\n]/g, "");
    if (clean) {
      setKey((v) => v + clean);
      setError(null);
    }
  });

  const compact = useMemo(() => LOGO_WIDTH > 80, []);

  return (
    <Box flexDirection="column" marginY={1}>
      {compact ? (
        <Text color={theme.accent} bold>
          ✶ zephyrcode
        </Text>
      ) : (
        LOGO.map((line, i) => (
          <Text key={i} color={theme.accent}>
            {line}
          </Text>
        ))
      )}
      <Box marginTop={1}>
        <Text color={theme.faint}>{`${TAGLINE} · first-run setup`}</Text>
      </Box>

      {step === "provider" ? (
        <Panel title="Choose a model provider">
          <Choices
            label="Which backend should drive the agent?"
            index={pIndex}
            items={providers.map((p) => ({ label: p.label }))}
          />
          <Text color={theme.faint}>↑↓ select · Enter continue · Ctrl+C quit</Text>
        </Panel>
      ) : step === "model" ? (
        <Panel title={`Choose a ${provider.label} model`}>
          <Choices
            label="Model"
            index={mIndex}
            items={provider.models.map((m) => ({ label: m.label, hint: `${Math.round(m.contextTokens / 1000)}k context` }))}
          />
          <Text color={theme.faint}>↑↓ select · Enter continue{providers.length > 1 ? " · Esc back" : ""} · Ctrl+C quit</Text>
        </Panel>
      ) : (
        <Panel title={`Connect ${provider.label}`}>
          <Box marginTop={1}>
            <Text color={theme.faint}>{provider.keyHint}</Text>
          </Box>
          <Box marginTop={1}>
            <Text color={theme.accent}>{"❯ "}</Text>
            {key.length === 0 ? (
              <>
                <Text inverse> </Text>
                <Text color={theme.faint}>paste your API key…</Text>
              </>
            ) : (
              <>
                <Text>{"•".repeat(key.length)}</Text>
                <Text inverse> </Text>
              </>
            )}
          </Box>
          {error ? <Text color={theme.error}>{`⚠ ${error}`}</Text> : null}
          <Text color={theme.faint}>Enter save · Esc skip (use the offline stub for now) · Ctrl+C quit</Text>
        </Panel>
      )}
    </Box>
  );
}
