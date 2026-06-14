/**
 * Presentational Ink components — a thin render of the reducer's view state. No
 * runtime/IO here; App wires events in and these just draw.
 */

import { homedir } from "node:os";
import { Box, Text, useStdout } from "ink";
import Spinner from "ink-spinner";
import type { SessionSummary } from "@zephyrcode/core";
import type { FileDiff, TodoItem } from "@zephyrcode/shared";
import { theme, toolDetail } from "./theme";
import { renderMarkdown } from "./markdown";
import { TAGLINE, WORDMARK_ROWS, WORDMARK_WIDTH } from "./banner";
import type { SlashCommand } from "./commands";
import type { Item, PendingPermission } from "./state";

/** Near-black for text printed ON the amber chip (warm, high-contrast on #e8a64d). */
const ON_ACCENT = "#15110a";

/** A top-lit amber ramp (bright → dim) applied row-by-row to the block wordmark for depth. */
const WORDMARK_RAMP = ["#f3c06a", "#ecac52", "#e8a64d", "#d99644", "#c4863c"];

/**
 * The product lockup: a solid amber "chip" reading ✶ zephyrcode. A filled color block
 * (not bare letters) so the mark reads as a deliberate badge. Used on onboarding and as
 * the welcome screen's fallback on terminals too narrow for the big block wordmark.
 */
export function Wordmark() {
  return (
    <Text backgroundColor={theme.accent} color={ON_ACCENT} bold>
      {"  ✶ zephyrcode  "}
    </Text>
  );
}

/** The big 5-row pixel wordmark (ZEPHYRCODE), each scan-line shaded by the top-lit ramp. */
export function BigWordmark() {
  return (
    <Box flexDirection="column">
      {WORDMARK_ROWS.map((row, i) => (
        <Text key={i} color={WORDMARK_RAMP[i] ?? theme.accent} bold>
          {row}
        </Text>
      ))}
    </Box>
  );
}

/**
 * The welcome screen shown on an empty session: the big block wordmark + workspace facts
 * wrapped in a single rounded amber card (the logo is framed, not floating). The card
 * hugs the wordmark; the orientation hints sit beneath it. Narrow terminals fall back to
 * the compact chip so the block art never wraps.
 */
export function WelcomeBanner({ model, cwd, effort, width }: { model: string; cwd: string; effort: string; width: number }) {
  const big = width >= WORDMARK_WIDTH + 8; // room for the art + border + padding
  return (
    <Box flexDirection="column" marginY={1}>
      {/* alignSelf flex-start so the card hugs the wordmark instead of stretching full-width
          (a tight gold plaque, no empty gutter on the right). */}
      <Box alignSelf="flex-start" flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={2} paddingY={1}>
        {big ? <BigWordmark /> : <Wordmark />}
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
      </Box>
      <Box marginTop={1} paddingX={1}>
        <Text color={theme.faint}>{"/help  ·  @ files  ·  ↑ history  ·  /resume  ·  say “ultrathink” to go deep"}</Text>
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

const HOME = homedir();

/** Collapse a leading $HOME to ~ so file paths in the activity line stay short. */
function collapseHome(p: string): string {
  return HOME && (p === HOME || p.startsWith(`${HOME}/`)) ? `~${p.slice(HOME.length)}` : p;
}

const FILE_TOOLS = new Set(["Read", "Write", "Edit"]);

/** Diff lines rendered inline before collapsing to a "+N more lines" footer (Claude-Code style). */
const MAX_DIFF_LINES = 10;

/**
 * A git-style diff block beneath a Write/Edit row: a line-number gutter, +/- signs colored
 * green/red, dim context, a `⋯` between non-contiguous hunks, and a `+N −M` stat footer.
 * Only the first ~10 diff lines are shown (enough to see WHAT is being written without
 * flooding the TUI); the rest collapse into a "+N more lines" hint. Long lines are clipped
 * to the terminal width so the block never wraps into noise.
 */
function DiffBlock({ diff }: { diff: FileDiff }) {
  const { stdout } = useStdout();
  const width = Math.max(40, stdout?.columns ?? 80);

  // Flatten hunks (tagging each line with its hunk index, to draw a ⋯ between hunks) and
  // cap the rendered preview. The +A/−R tally below stays the TRUE total either way.
  const flat = diff.hunks.flatMap((hunk, hi) => hunk.lines.map((line) => ({ line, hi })));
  const visible = flat.slice(0, MAX_DIFF_LINES);
  const shownChanged = visible.filter(({ line }) => line.kind !== "context").length;
  const hiddenChanged = diff.added + diff.removed - shownChanged;

  const gw = Math.max(2, ...visible.map(({ line }) => String(line.newLine ?? line.oldLine ?? 0).length));
  const textWidth = Math.max(8, width - gw - 5); // gutter + " " + sign + " " + margin
  const clip = (s: string) => (s.length > textWidth ? `${s.slice(0, textWidth - 1)}…` : s);

  return (
    <Box flexDirection="column" marginLeft={2}>
      {visible.map(({ line, hi }, i) => {
        const num = line.newLine ?? line.oldLine;
        const gutter = (num !== undefined ? String(num) : "").padStart(gw);
        const sign = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
        const color = line.kind === "add" ? theme.success : line.kind === "del" ? theme.error : theme.faint;
        const hunkBreak = i > 0 && hi !== visible[i - 1]!.hi; // crossed into a new hunk
        return (
          <Box key={i} flexDirection="column">
            {hunkBreak ? <Text color={theme.faint}>{`${" ".repeat(gw)}  ⋯`}</Text> : null}
            <Text color={color}>{`${gutter} ${sign} ${clip(line.text)}`}</Text>
          </Box>
        );
      })}
      <Box>
        <Text color={theme.success}>{`${" ".repeat(gw)}  +${diff.added}`}</Text>
        <Text color={theme.error}>{` −${diff.removed}`}</Text>
        {hiddenChanged > 0 ? (
          <Text color={theme.faint}>{`  … +${hiddenChanged} more line${hiddenChanged === 1 ? "" : "s"}`}</Text>
        ) : null}
      </Box>
    </Box>
  );
}

function ToolView({ item }: { item: Extract<Item, { kind: "tool" }> }) {
  const raw = toolDetail(item.name, item.input);
  const detail = FILE_TOOLS.has(item.name) ? collapseHome(raw) : raw;
  const dur = item.durationMs !== undefined && item.durationMs >= 1000 ? ` (${(item.durationMs / 1000).toFixed(1)}s)` : "";
  const done = item.status !== "running";
  // When a diff is shown, it (with its +N −M stat) replaces the textual summary — otherwise
  // the row would repeat the path ("Edit <path>" + "Edited <path> (1 replacement)").
  const showDiff = done && !!item.diff && item.diff.hunks.length > 0;
  // Read's summary is just the file's first line (noise next to the path); diffed mutations
  // defer to the block. Everything else (Bash exit, Grep/Glob counts) keeps its summary.
  const showSummary = !!item.summary && done && item.name !== "Read" && !showDiff;
  return (
    <Box flexDirection="column">
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
        {showSummary ? (
          <Text color={theme.faint}>{`  ${item.summary}${dur}`}</Text>
        ) : done && dur ? (
          <Text color={theme.faint}>{dur}</Text>
        ) : null}
      </Box>
      {showDiff ? <DiffBlock diff={item.diff!} /> : null}
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

/**
 * The prompt input: the editable line inside a full rounded box (clear top + bottom
 * borders, so it reads as a real field, not a floating line), with the current effort
 * (and output style, if any) on a faint status row beneath it.
 */
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
  const status = `✶ ${effort}${outputStyle ? ` · ${outputStyle}` : ""}`;
  return (
    <Box flexDirection="column" marginTop={1} width={Math.max(20, width)}>
      <Box borderStyle="round" borderColor={theme.accent} paddingX={1}>
        <InputLine value={value} cursor={cursor} ghost={ghost} placeholder={placeholder} showCursor={showCursor} />
      </Box>
      <Box justifyContent="flex-end" paddingRight={1}>
        <Text color={theme.faint}>{status}</Text>
      </Box>
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
  if (value.length === 0) {
    return (
      <Box>
        <Text color={theme.accent}>{"❯ "}</Text>
        {showCursor ? <Text inverse> </Text> : null}
        {placeholder ? <Text color={theme.faint}>{placeholder}</Text> : null}
      </Box>
    );
  }

  // Multi-line aware: split on "\n" and place the block cursor on its row/col. Continuation
  // rows align under the "❯ " gutter so a multi-line prompt reads as one indented block.
  const lines = value.split("\n");
  let row = 0;
  let col = cursor;
  while (row < lines.length - 1 && col > lines[row]!.length) {
    col -= lines[row]!.length + 1; // +1 for the consumed "\n"
    row++;
  }

  return (
    <Box flexDirection="column">
      {lines.map((line, r) => {
        const prefix = r === 0 ? "❯ " : "  ";
        const ghostTail = r === lines.length - 1 && ghost ? <Text color={theme.faint}>{ghost}</Text> : null;
        if (r !== row || !showCursor) {
          return (
            <Box key={r}>
              <Text color={theme.accent}>{prefix}</Text>
              <Text>{line}</Text>
              {ghostTail}
            </Box>
          );
        }
        const at = line.slice(col, col + 1);
        return (
          <Box key={r}>
            <Text color={theme.accent}>{prefix}</Text>
            <Text>{line.slice(0, col)}</Text>
            <Text inverse>{at.length ? at : " "}</Text>
            <Text>{line.slice(col + 1)}</Text>
            {ghostTail}
          </Box>
        );
      })}
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
          ? "[y] once · [a] always (local) · [A] always (project) · [n]/esc no · ctrl+c quit"
          : "[y] allow once · [n]/esc deny · ctrl+c quit"}
      </Text>
    </Box>
  );
}
