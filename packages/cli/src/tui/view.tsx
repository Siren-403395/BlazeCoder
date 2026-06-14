/**
 * Presentational Ink components — a thin render of the reducer's view state. No
 * runtime/IO here; App wires events in and these just draw.
 */

import { Box, Text, useStdout } from "ink";
import Spinner from "ink-spinner";
import type { SessionSummary } from "@coding-agent/core";
import type { TodoItem } from "@coding-agent/shared";
import { theme, toolDetail } from "./theme";
import { renderMarkdown } from "./markdown";
import { LOGO, LOGO_WIDTH, TAGLINE } from "./banner";
import type { SlashCommand } from "./commands";
import type { Item, PendingPermission } from "./state";

/** The welcome screen shown on an empty session: logo wordmark + orientation. */
export function WelcomeBanner({ model, cwd, effort, width }: { model: string; cwd: string; effort: string; width: number }) {
  const compact = width < LOGO_WIDTH + 2;
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
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
        <Text color={theme.faint}>{TAGLINE}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text color={theme.muted}>{"cwd    "}</Text>
          <Text color={theme.faint}>{cwd}</Text>
        </Text>
        <Text>
          <Text color={theme.muted}>{"model  "}</Text>
          <Text color={theme.faint}>{`${model} · effort ${effort}`}</Text>
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.faint}>/help for commands · @ to add files · ↑ for history · /resume to reopen a chat</Text>
      </Box>
    </Box>
  );
}

/** Finalized assistant prose, rendered as Markdown (headings, bold, lists, code). */
function Markdown({ text }: { text: string }) {
  const { stdout } = useStdout();
  const width = Math.max(20, (stdout?.columns ?? 80) - 2);
  return <Text>{renderMarkdown(text, width)}</Text>;
}

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

function AssistantView({ item }: { item: Extract<Item, { kind: "assistant" }> }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      {item.text ? (
        item.streaming ? (
          <Text wrap="wrap">{item.text}</Text>
        ) : (
          <Markdown text={item.text} />
        )
      ) : item.streaming ? (
        <Text color={theme.faint}>…</Text>
      ) : null}
    </Box>
  );
}

export function ItemView({ item }: { item: Item }) {
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
      return <AssistantView item={item} />;
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
          <Text color={item.subtype === "success" ? theme.success : theme.error}>●</Text>
          <Text color={theme.faint}> {item.subtype === "success" ? "done" : item.subtype}</Text>
        </Box>
      );
  }
}

/**
 * The live "working…" line: an animated spinner + a rotating verb + a meta
 * parenthetical (elapsed · tokens · phase · effort) the caller composes.
 */
export function LoadingLine({ word, meta }: { word: string; meta: string }) {
  return (
    <Box marginTop={1}>
      <Text color={theme.accent}>
        <Spinner type="dots" />
      </Text>
      <Text color={theme.accent} italic>
        {` ${word}…`}
      </Text>
      <Text color={theme.faint}>{`  (${meta})`}</Text>
    </Box>
  );
}

/** The prompt input: a top rule carrying the current effort, then the editable line. */
export function InputBox({
  value,
  cursor,
  ghost,
  placeholder,
  effort,
  outputStyle,
  width,
  showCursor = true,
}: {
  value: string;
  cursor: number;
  ghost?: string | null;
  placeholder?: string;
  effort: string;
  outputStyle?: string;
  width: number;
  showCursor?: boolean;
}) {
  const label = ` ✶ ${effort}${outputStyle ? ` · ${outputStyle}` : ""} `;
  const dashes = Math.max(2, width - label.length - 1);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={theme.faint}>{"─".repeat(dashes)}</Text>
        <Text color={theme.accent}>{label}</Text>
        <Text color={theme.faint}>─</Text>
      </Box>
      <InputLine value={value} cursor={cursor} ghost={ghost} placeholder={placeholder} showCursor={showCursor} />
    </Box>
  );
}

/** A faint product tip shown beneath the prompt. */
/** The live task list (TodoWrite) as a compact panel above the input. */
export function TodoPanel({ todos }: { todos: TodoItem[] }) {
  if (todos.length === 0) return null;
  const done = todos.filter((t) => t.status === "completed").length;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.faint}>{`Tasks · ${done}/${todos.length} done`}</Text>
      {todos.map((t, i) => {
        const mark = t.status === "completed" ? "✔" : t.status === "in_progress" ? "▶" : "○";
        const color = t.status === "completed" ? theme.faint : t.status === "in_progress" ? theme.accent : undefined;
        const label = t.status === "in_progress" ? t.activeForm : t.content;
        return (
          <Text key={i} color={color} strikethrough={t.status === "completed"}>
            {`  ${mark} ${label}`}
          </Text>
        );
      })}
    </Box>
  );
}

export function TipLine({ tip }: { tip: string }) {
  return <Text color={theme.faint}>{`  Tip: ${tip}`}</Text>;
}

/** The editable prompt line with a block cursor, optional faint arg-hint ghost, and a placeholder. */
export function InputLine({
  value,
  cursor,
  ghost,
  placeholder,
  showCursor = true,
}: {
  value: string;
  cursor: number;
  ghost?: string | null;
  placeholder?: string;
  showCursor?: boolean;
}) {
  const before = value.slice(0, cursor);
  const at = value.slice(cursor, cursor + 1);
  const after = value.slice(cursor + 1);
  return (
    <Box>
      <Text color={theme.accent}>{"❯ "}</Text>
      {value.length === 0 ? (
        <>
          {showCursor ? <Text inverse> </Text> : null}
          {placeholder ? <Text color={theme.faint}>{placeholder}</Text> : null}
        </>
      ) : (
        <>
          <Text>{before}</Text>
          {showCursor ? <Text inverse>{at.length ? at : " "}</Text> : <Text>{at}</Text>}
          <Text>{after}</Text>
          {ghost ? <Text color={theme.faint}>{ghost}</Text> : null}
        </>
      )}
    </Box>
  );
}

/** @-mention file completion list. */
export function FileCompletion({ files, index }: { files: string[]; index: number }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      {files.map((f, i) => (
        <Text key={f} color={i === index ? theme.accent : theme.muted} bold={i === index}>
          {(i === index ? "❯ " : "  ") + f}
        </Text>
      ))}
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

/**
 * A generic single-select list in the same bordered style as SessionPicker, driven by
 * `{ name, description }` items. Shared by the /skill and /output-style palettes (Skill
 * and OutputStyle both satisfy this shape, so no adapter is needed).
 */
export function ChoicePicker({
  title,
  items,
  index,
}: {
  title: string;
  items: { name: string; description: string }[];
  index: number;
}) {
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        {title}
      </Text>
      {items.length === 0 ? (
        <Text color={theme.faint}>None available.</Text>
      ) : (
        items.map((it, i) => {
          const selected = i === index;
          return (
            <Box key={it.name}>
              <Text color={selected ? theme.accent : theme.muted} bold={selected}>
                {(selected ? "❯ " : "  ") + it.name}
              </Text>
              <Text color={theme.faint}>{`  ${it.description}`}</Text>
            </Box>
          );
        })
      )}
      <Text color={theme.faint}>↑↓ select · Enter choose · Esc cancel</Text>
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
      {p.suggestions?.length ? <Text color={theme.muted}>always-allow rule: {p.suggestions[0]}</Text> : null}
      <Text color={theme.faint}>
        {p.suggestions?.length
          ? "[y] once · [a] always (local) · [A] always (project) · [n] no"
          : "[y] allow once · [n] deny"}
      </Text>
    </Box>
  );
}
