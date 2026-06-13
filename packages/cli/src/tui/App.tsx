/**
 * The root TUI component. Owns the reducer, drives the AgentRuntime in-process
 * (no HTTP), and renders a BOUNDED WINDOW of recent scrollback items plus a live
 * region: an animated "working…" line while running, a bordered prompt that
 * carries the current effort on its top rule, and a rotating product tip.
 *
 * We deliberately do NOT use Ink's <Static>: it is append-only (its internal
 * index never rewinds) and its `fullStaticOutput` buffer grows without bound and
 * has no reset, which makes /resume visibly stack transcripts and long sessions
 * blow the render up. Rendering a trailing window instead lets `hydrate` cleanly
 * REPLACE the screen and keeps the painted height finite. The input is a
 * hand-rolled editor (own value + cursor) so we fully control the cursor for
 * Tab-completion, command history, and @-mention file completion.
 */

import { homedir } from "node:os";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import {
  EFFORTS,
  escalateFromPrompt,
  isEffort,
  type AgentRuntime,
  type Effort,
  type SessionState,
  type SessionSummary,
} from "@coding-agent/core";
import { applyEvent, initialState } from "./state";
import { argGhost, atToken, filterFiles, findCommand, palette } from "./commands";
import { CommandPalette, FileCompletion, InputBox, ItemView, LoadingLine, PermissionPrompt, SessionPicker, TipLine, TodoPanel, WelcomeBanner } from "./view";
import { freshSeed, loadingWord, tipAt } from "./flavor";
import { theme } from "./theme";

/** Cap the number of scrollback items painted at once so the frame stays finite. */
const MAX_VISIBLE_ITEMS = 50;

type Completion =
  | { kind: "command"; matches: { name: string; argHint?: string }[] }
  | { kind: "file"; matches: string[]; start: number };

function formatElapsed(sec: number): string {
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** Shorten an absolute path by collapsing the home dir to "~". */
function prettyPath(p: string): string {
  const home = homedir();
  return home && (p === home || p.startsWith(`${home}/`)) ? `~${p.slice(home.length)}` : p;
}

export function App({
  runtime,
  effort = "high",
  initialSession,
}: {
  runtime: AgentRuntime;
  effort?: string;
  initialSession?: SessionState;
}) {
  const [state, dispatch] = useReducer(applyEvent, undefined, () => {
    const base = initialState(effort);
    return initialSession ? applyEvent(base, { type: "hydrate", session: initialSession }) : base;
  });
  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState(0);
  const [compIndex, setCompIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [picker, setPicker] = useState<{ sessions: SessionSummary[]; index: number } | null>(null);
  const { exit } = useApp();
  const { stdout } = useStdout();
  const width = Math.max(40, stdout?.columns ?? 80);

  const sessionId = useRef<string | undefined>(initialSession?.id);
  const abort = useRef<AbortController | null>(null);
  // Between-turns steering: Enter-while-running enqueues here; the loop drains it.
  const steerQueue = useRef<string[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const effortRef = useRef(state.effort);
  effortRef.current = state.effort;
  const files = useRef<string[]>([]);
  const [, setFilesTick] = useState(0);
  const history = useRef<string[]>([]);
  const histCursor = useRef(0); // 0 = live draft; n = n-th most recent submission
  const liveDraft = useRef("");
  const wordSeed = useRef(0); // varies the loading-verb sequence per run
  const tipIndex = useRef(Math.floor(Math.random() * 1000));

  const busy = state.status === "running" || state.status === "awaiting_permission";

  // Tick a one-second clock while running, for the elapsed time + verb rotation.
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  // Load the workspace file list for @-completion (on mount, and after each run).
  const loadFiles = useCallback(async () => {
    files.current = await runtime.listFiles().catch(() => []);
    setFilesTick((t) => t + 1);
  }, [runtime]);
  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);
  useEffect(() => {
    if (state.status === "done" || state.status === "error") void loadFiles();
  }, [state.status, loadFiles]);

  // Derive the active completion (command palette takes precedence over @-files).
  const pal = palette(draft);
  const fileTok = atToken(draft, cursor);
  const fileMatches = fileTok ? filterFiles(files.current, fileTok.query) : [];
  const completion: Completion | null = pal.open
    ? { kind: "command", matches: pal.matches }
    : fileTok && fileMatches.length
      ? { kind: "file", matches: fileMatches, start: fileTok.start }
      : null;
  const cidx = completion ? Math.min(compIndex, completion.matches.length - 1) : 0;
  const ghost = argGhost(draft);

  const setLine = useCallback((value: string, cur: number) => {
    setDraft(value);
    setCursor(cur);
    setCompIndex(0);
    histCursor.current = 0;
  }, []);

  const openResume = useCallback(async () => {
    setPicker({ sessions: await runtime.listSessions(), index: 0 });
  }, [runtime]);

  const openSession = useCallback(
    async (summary: SessionSummary) => {
      const s = await runtime.getSession(summary.id);
      if (s) {
        dispatch({ type: "hydrate", session: s });
        sessionId.current = s.id;
      }
      setPicker(null);
    },
    [runtime],
  );

  const execSlash = useCallback(
    async (name: string, arg: string) => {
      const cmd = findCommand(name);
      switch (cmd?.name) {
        case "exit":
          exit();
          return;
        case "clear":
          dispatch({ type: "reset" });
          sessionId.current = undefined;
          return;
        case "effort":
          if (isEffort(arg)) dispatch({ type: "set_effort", effort: arg });
          else dispatch({ type: "notice", level: "warn", message: `Usage: /effort <${EFFORTS.join("|")}>` });
          return;
        case "usage": {
          const s = stateRef.current;
          dispatch({
            type: "notice",
            level: "info",
            message: `${s.model ?? "?"} · effort ${s.effort} · $${s.costUsd.toFixed(4)} this session · ${s.turns} turn${s.turns === 1 ? "" : "s"}`,
          });
          return;
        }
        case "context": {
          const { tokensUsed, tokensTotal } = stateRef.current;
          const pct = tokensTotal ? Math.round((100 * tokensUsed) / tokensTotal) : 0;
          dispatch({
            type: "notice",
            level: "info",
            message: tokensTotal
              ? `Context ${pct}% — ${tokensUsed} / ${tokensTotal} tokens`
              : "Context usage will appear after the first turn.",
          });
          return;
        }
        case "resume":
          await openResume();
          return;
        case "help":
          dispatch({
            type: "notice",
            level: "info",
            message:
              "/resume · /effort <low|high|ultra> · /usage · /context · /clear · /help · /exit. Type @ to reference a file, Tab to complete, ↑ for history. Say 'ultrathink' to push a turn to max effort. Esc interrupts; Ctrl+C quits.",
          });
          return;
        default:
          dispatch({ type: "notice", level: "warn", message: `Unknown command: /${name}` });
      }
    },
    [exit, openResume],
  );

  const submit = useCallback(
    async (value: string) => {
      const text = value.trim();
      setLine("", 0);
      if (!text) return;
      if (history.current[history.current.length - 1] !== text) history.current.push(text);
      histCursor.current = 0;
      tipIndex.current += 1; // rotate the tip after each submission

      if (text.startsWith("/")) {
        const m = /^\/(\S+)\s*(.*)$/.exec(text);
        if (m) await execSlash(m[1]!, m[2]!.trim());
        return;
      }

      dispatch({ type: "user_prompt", text });
      wordSeed.current = freshSeed();
      const turnEffort = escalateFromPrompt(text, effortRef.current as Effort);
      const ac = new AbortController();
      abort.current = ac;
      try {
        const { session } = await runtime.run(
          {
            prompt: text,
            sessionId: sessionId.current,
            effort: turnEffort,
            steering: { drain: () => steerQueue.current.splice(0) },
          },
          (e) => dispatch(e),
          ac.signal,
        );
        sessionId.current = session.id;
      } catch (err) {
        dispatch({ type: "notice", level: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        abort.current = null;
      }
    },
    [setLine, execSlash, runtime],
  );

  const accept = useCallback(() => {
    if (!completion) return;
    if (completion.kind === "command") {
      const cmd = completion.matches[cidx]!;
      const next = `/${cmd.name} `;
      setLine(next, next.length);
    } else {
      const file = completion.matches[cidx]!;
      const inserted = `@${file} `;
      const next = draft.slice(0, completion.start) + inserted + draft.slice(cursor);
      setLine(next, completion.start + inserted.length);
    }
  }, [completion, cidx, draft, cursor, setLine]);

  const historyUp = useCallback(() => {
    const h = history.current;
    if (histCursor.current >= h.length) return;
    if (histCursor.current === 0) liveDraft.current = draft;
    histCursor.current += 1;
    const v = h[h.length - histCursor.current]!;
    setDraft(v);
    setCursor(v.length);
    setCompIndex(0);
  }, [draft]);

  const historyDown = useCallback(() => {
    if (histCursor.current === 0) return;
    histCursor.current -= 1;
    const v = histCursor.current === 0 ? liveDraft.current : history.current[history.current.length - histCursor.current]!;
    setDraft(v);
    setCursor(v.length);
    setCompIndex(0);
  }, []);

  useInput((input, key) => {
    // 1) Permission approval.
    if (state.status === "awaiting_permission" && state.permission) {
      const reqId = state.permission.requestId;
      if (input === "y" || input === "a") {
        runtime.resolvePermission(reqId, { behavior: "allow" });
        dispatch({ type: "permission_resolved" });
      } else if (input === "n") {
        runtime.resolvePermission(reqId, { behavior: "deny", message: "Denied by the user." });
        dispatch({ type: "permission_resolved" });
      }
      return;
    }

    // 2) Session picker.
    if (picker) {
      if (key.upArrow) setPicker((p) => (p ? { ...p, index: Math.max(0, p.index - 1) } : p));
      else if (key.downArrow) setPicker((p) => (p ? { ...p, index: Math.min(p.sessions.length - 1, p.index + 1) } : p));
      else if (key.return && picker.sessions.length) void openSession(picker.sessions[picker.index]!);
      else if (key.escape) setPicker(null);
      return;
    }

    // 3) Running: Esc interrupts, Ctrl+C quits, Enter queues a steering message;
    //    other keys fall through so the user can type that message.
    if (busy) {
      if (key.escape && abort.current) {
        abort.current.abort();
        return;
      }
      if (key.ctrl && input === "c") {
        exit();
        return;
      }
      if (key.return) {
        const text = draft.trim();
        if (text) {
          steerQueue.current.push(text);
          dispatch({ type: "notice", level: "info", message: `(steering) queued: ${text}` });
          setLine("", 0);
        }
        return;
      }
      // fall through to the editing handlers below so typing works while running
    }

    // 4) Editing the prompt line.
    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    if (key.return) {
      void submit(draft);
      return;
    }
    if (key.tab || input === "\t") {
      accept();
      return;
    }
    if (key.upArrow) {
      if (completion) setCompIndex((i) => Math.max(0, i - 1));
      else historyUp();
      return;
    }
    if (key.downArrow) {
      if (completion) setCompIndex((i) => Math.min(completion.matches.length - 1, i + 1));
      else historyDown();
      return;
    }
    if (key.leftArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor((c) => Math.min(draft.length, c + 1));
      return;
    }
    if (key.backspace || key.delete) {
      if (cursor > 0) setLine(draft.slice(0, cursor - 1) + draft.slice(cursor), cursor - 1);
      return;
    }
    if (key.escape) {
      if (abort.current) abort.current.abort();
      return;
    }
    if (key.ctrl || key.meta || !input) return;
    setLine(draft.slice(0, cursor) + input + draft.slice(cursor), cursor + input.length);
  });

  // Paint only a trailing window of the transcript so the rendered height stays
  // bounded (long sessions never "blow up"); older items scroll out of view.
  const hidden = Math.max(0, state.items.length - MAX_VISIBLE_ITEMS);
  const visible = hidden > 0 ? state.items.slice(-MAX_VISIBLE_ITEMS) : state.items;

  // Live "working…" line content.
  const word = loadingWord(wordSeed.current, Math.floor(elapsed / 3));
  const tokens = Math.round(state.turnChars / 4);
  const runningTool = [...state.items].reverse().find((i) => i.kind === "tool" && i.status === "running");
  const phase = runningTool && runningTool.kind === "tool" ? `running ${runningTool.name}` : "thinking";
  const meta = `${formatElapsed(elapsed)} · ↓ ${formatTokens(tokens)} tokens · ${phase} at ${state.effort} effort`;
  const tip = tipAt(tipIndex.current);

  return (
    <Box flexDirection="column">
      {state.items.length === 0 ? (
        <WelcomeBanner model={runtime.model} cwd={prettyPath(runtime.cwd)} effort={state.effort} width={width} />
      ) : (
        <>
          {hidden > 0 ? (
            <Text color={theme.faint}>{`⋯ ${hidden} earlier message${hidden === 1 ? "" : "s"} hidden`}</Text>
          ) : null}
          {visible.map((item) => (
            <ItemView key={item.id} item={item} />
          ))}
        </>
      )}

      {!picker && !state.permission ? <TodoPanel todos={state.todos} /> : null}

      {busy && !state.permission && !picker ? <LoadingLine word={word} meta={meta} /> : null}

      {picker ? (
        <SessionPicker sessions={picker.sessions} index={picker.index} />
      ) : state.permission ? (
        <PermissionPrompt p={state.permission} />
      ) : (
        <Box flexDirection="column">
          <InputBox
            value={draft}
            cursor={cursor}
            ghost={ghost}
            placeholder={busy ? "working… (type + enter to steer · esc to interrupt)" : "Ask, or / for commands, @ for files"}
            effort={state.effort}
            width={width}
            showCursor={true}
          />
          {completion?.kind === "command" ? (
            <CommandPalette matches={pal.matches} index={cidx} />
          ) : completion?.kind === "file" ? (
            <FileCompletion files={completion.matches} index={cidx} />
          ) : (
            <TipLine tip={tip} />
          )}
        </Box>
      )}
    </Box>
  );
}
