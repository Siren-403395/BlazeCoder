/**
 * The root TUI component. Owns the reducer, drives the AgentRuntime in-process
 * (no HTTP), and renders an immutable <Static> scrollback + a live region with a
 * custom prompt input. The input is hand-rolled (value + cursor) rather than
 * ink-text-input so we fully control the cursor for Tab-completion, command
 * history, and @-mention file completion.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import {
  EFFORTS,
  escalateFromPrompt,
  isEffort,
  type AgentRuntime,
  type Effort,
  type SessionState,
  type SessionSummary,
} from "@coding-agent/core";
import { applyEvent, initialState, type Item, type ReasoningDisplay } from "./state";
import { argGhost, atToken, filterFiles, findCommand, palette } from "./commands";
import { CommandPalette, FileCompletion, InputLine, ItemView, PermissionPrompt, SessionPicker, StatusBar } from "./view";
import { theme } from "./theme";

const REASONING_MODES: ReasoningDisplay[] = ["hidden", "summary", "full"];

function isFinalized(item: Item): boolean {
  if (item.kind === "assistant") return !item.streaming;
  if (item.kind === "tool") return item.status !== "running";
  return true;
}

type Completion =
  | { kind: "command"; matches: { name: string; argHint?: string }[] }
  | { kind: "file"; matches: string[]; start: number };

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
  const [picker, setPicker] = useState<{ sessions: SessionSummary[]; index: number } | null>(null);
  const { exit } = useApp();

  const sessionId = useRef<string | undefined>(initialSession?.id);
  const abort = useRef<AbortController | null>(null);
  const effortRef = useRef(state.effort);
  effortRef.current = state.effort;
  const files = useRef<string[]>([]);
  const [, setFilesTick] = useState(0);
  const history = useRef<string[]>([]);
  const histCursor = useRef(0); // 0 = live draft; n = n-th most recent submission
  const liveDraft = useRef("");

  const busy = state.status === "running" || state.status === "awaiting_permission";

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
        case "reasoning":
          if ((REASONING_MODES as string[]).includes(arg)) dispatch({ type: "set_reasoning", reasoning: arg as ReasoningDisplay });
          else dispatch({ type: "notice", level: "warn", message: `Usage: /reasoning <${REASONING_MODES.join("|")}>` });
          return;
        case "resume":
          await openResume();
          return;
        case "help":
          dispatch({
            type: "notice",
            level: "info",
            message:
              "/resume · /effort <level> · /reasoning <hidden|summary|full> · /clear · /help · /exit. Type @ to reference a file, Tab to complete, ↑ for history. Say 'ultrathink' to push a turn to max effort. Esc interrupts; Ctrl+C quits.",
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

      if (text.startsWith("/")) {
        const m = /^\/(\S+)\s*(.*)$/.exec(text);
        if (m) await execSlash(m[1]!, m[2]!.trim());
        return;
      }

      dispatch({ type: "user_prompt", text });
      const turnEffort = escalateFromPrompt(text, effortRef.current as Effort);
      const ac = new AbortController();
      abort.current = ac;
      try {
        const { session } = await runtime.run(
          { prompt: text, sessionId: sessionId.current, effort: turnEffort },
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

    // 3) Running: input is hidden; only interrupt/quit.
    if (busy) {
      if (key.escape && abort.current) abort.current.abort();
      if (key.ctrl && input === "c") exit();
      return;
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

  const finalized = state.items.filter(isFinalized);
  const live = state.items.filter((i) => !isFinalized(i));

  return (
    <Box flexDirection="column">
      <Static items={finalized}>{(item) => <ItemView key={item.id} item={item} reasoning={state.reasoning} />}</Static>

      <Box flexDirection="column">
        {live.map((item) => (
          <ItemView key={item.id} item={item} reasoning={state.reasoning} />
        ))}

        {picker ? (
          <SessionPicker sessions={picker.sessions} index={picker.index} />
        ) : state.permission ? (
          <PermissionPrompt p={state.permission} />
        ) : busy ? (
          <Box marginTop={1}>
            <Text color={theme.accent}>
              <Spinner type="dots" />
            </Text>
            <Text color={theme.faint}> working… (esc to interrupt)</Text>
          </Box>
        ) : (
          <Box marginTop={1} flexDirection="column">
            <InputLine value={draft} cursor={cursor} ghost={ghost} placeholder="Ask, or / for commands, @ for files" />
            {completion?.kind === "command" ? <CommandPalette matches={pal.matches} index={cidx} /> : null}
            {completion?.kind === "file" ? <FileCompletion files={completion.matches} index={cidx} /> : null}
          </Box>
        )}

        <StatusBar state={state} />
      </Box>
    </Box>
  );
}
