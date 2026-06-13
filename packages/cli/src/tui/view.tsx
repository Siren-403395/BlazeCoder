/**
 * Presentational Ink components — a thin render of the reducer's view state. No
 * runtime/IO here; App wires events in and these just draw.
 */

import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { SessionSummary } from "@coding-agent/core";
import { theme, toolDetail } from "./theme";
import type { SlashCommand } from "./commands";
import type { Item, PendingPermission, ReasoningDisplay, TuiState } from "./state";

function ToolView({ item }: { item: Extract<Item, { kind: "tool" }> }) {
  const detail = toolDetail(item.name, item.input);
  const dur = item.durationMs !== undefined && item.durationMs >= 1000 ? ` (${(item.durationMs / 1000).toFixed(1)}s)` : "";
  return (
    <Box>
      {item.status === "running" ? (
        <Text color={theme.accent}>
          <Spinner type="dots" />
        </Text>
      ) : (
        <Text color={item.status === "error" ? theme.error : theme.success}>{item.status === "error" ? "✘" : "✔"}</Text>
      )}
      <Text color={theme.muted}> {item.name}</Text>
      {detail ? <Text color={theme.faint}> {detail}</Text> : null}
      {item.summary && item.status !== "running" ? <Text color={theme.faint}>{`  ${item.summary}${dur}`}</Text> : null}
    </Box>
  );
}

function ReasoningView({ item, mode }: { item: Extract<Item, { kind: "assistant" }>; mode: ReasoningDisplay }) {
  if (mode === "hidden" || !item.reasoning) return null;
  // While streaming, always show the live thinking. Once finalized, "summary"
  // collapses it to a single dim line; "full" keeps the whole trace.
  if (!item.streaming && mode === "summary") {
    return <Text color={theme.accentDim}>✷ thought for a moment</Text>;
  }
  return (
    <Box flexDirection="column" marginBottom={item.text ? 1 : 0}>
      <Text color={theme.accentDim}>✷ thinking{item.streaming && !item.text ? "…" : ""}</Text>
      <Text color={theme.faint} wrap="wrap">
        {item.reasoning}
      </Text>
    </Box>
  );
}

function AssistantView({ item, reasoning }: { item: Extract<Item, { kind: "assistant" }>; reasoning: ReasoningDisplay }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <ReasoningView item={item} mode={reasoning} />
      {item.text ? (
        <Text wrap="wrap">{item.text}</Text>
      ) : item.streaming && (!item.reasoning || reasoning === "hidden") ? (
        <Text color={theme.faint}>…</Text>
      ) : null}
    </Box>
  );
}

export function ItemView({ item, reasoning = "summary" }: { item: Item; reasoning?: ReasoningDisplay }) {
  switch (item.kind) {
    case "user":
      return (
        <Box marginTop={1}>
          <Text color={theme.user} bold>
            {"› "}
          </Text>
          <Text color={theme.user}>{item.text}</Text>
        </Box>
      );
    case "assistant":
      return <AssistantView item={item} reasoning={reasoning} />;
    case "tool":
      return <ToolView item={item} />;
    case "notice":
      return (
        <Text color={item.level === "error" ? theme.error : item.level === "warn" ? theme.warn : theme.muted}>
          {item.level === "error" ? "✘ " : item.level === "warn" ? "⚠ " : "› "}
          {item.message}
        </Text>
      );
    case "compact":
      return (
        <Text color={theme.faint} italic>
          ⟳ context compacted ({item.reason})
        </Text>
      );
    case "result":
      return (
        <Box marginTop={1}>
          <Text color={item.subtype === "success" ? theme.success : theme.error}>
            {item.subtype === "success" ? "● " : "● "}
          </Text>
          <Text color={theme.faint}>{item.subtype === "success" ? "done" : item.subtype}</Text>
        </Box>
      );
  }
}

export function StatusBar({ state }: { state: TuiState }) {
  const pct = state.tokensTotal ? Math.round((100 * state.tokensUsed) / state.tokensTotal) : 0;
  return (
    <Box marginTop={1}>
      <Text color={theme.faint}>
        {state.model ?? "?"} · effort {state.effort} · reasoning {state.reasoning} · turn {state.turns}/
        {state.maxTurns} · ctx {pct}% · ${state.costUsd.toFixed(4)}
      </Text>
    </Box>
  );
}

/** The autocomplete palette shown while typing a slash command (mirrors the screenshot). */
export function CommandPalette({ matches, index }: { matches: SlashCommand[]; index: number }) {
  const width = Math.max(...matches.map((c) => c.name.length)) + 3;
  return (
    <Box flexDirection="column" marginTop={1}>
      {matches.map((c, i) => {
        const selected = i === index;
        return (
          <Box key={c.name}>
            <Text color={selected ? theme.accent : theme.user} bold={selected}>
              {(selected ? "❯ /" : "  /") + c.name.padEnd(width)}
            </Text>
            <Text color={theme.faint}>{c.description}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

function stamp(ms: number): string {
  try {
    return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
  } catch {
    return String(ms);
  }
}

/** Interactive list to pick a past session to resume. */
export function SessionPicker({ sessions, index }: { sessions: SessionSummary[]; index: number }) {
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        Resume a conversation
      </Text>
      {sessions.length === 0 ? (
        <Text color={theme.faint}>No saved sessions yet.</Text>
      ) : (
        sessions.map((s, i) => {
          const selected = i === index;
          return (
            <Box key={s.id}>
              <Text color={selected ? theme.accent : theme.muted} bold={selected}>
                {(selected ? "❯ " : "  ") + (s.title || s.id)}
              </Text>
              <Text color={theme.faint}>{`  ${stamp(s.updatedAt)} · ${s.turns} turn${s.turns === 1 ? "" : "s"}`}</Text>
            </Box>
          );
        })
      )}
      <Text color={theme.faint}>↑↓ select · Enter open · Esc cancel</Text>
    </Box>
  );
}

export function PermissionPrompt({ p }: { p: PendingPermission }) {
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        Permission required
      </Text>
      <Text>{p.reason}</Text>
      <Text color={theme.muted}>
        {p.toolName} {toolDetail(p.toolName, p.input)}
      </Text>
      <Text color={theme.faint}>[y] allow once · [a] allow + remember · [n] deny</Text>
    </Box>
  );
}
