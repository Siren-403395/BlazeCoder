/**
 * The root TUI component. Owns the reducer, drives the AgentRuntime in-process
 * (no HTTP), maps its event stream into the reducer, and renders a two-region
 * layout: an immutable <Static> scrollback of finalized turns + a live region for
 * the in-flight assistant, running tools, the prompt, and overlays (the slash-
 * command palette, the /resume session picker, and permission approvals).
 */

import { useCallback, useReducer, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
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
import { argGhost, findCommand, palette } from "./commands";
import { CommandPalette, ItemView, PermissionPrompt, SessionPicker, StatusBar } from "./view";
import { theme } from "./theme";

const REASONING_MODES: ReasoningDisplay[] = ["hidden", "summary", "full"];

function isFinalized(item: Item): boolean {
  if (item.kind === "assistant") return !item.streaming;
  if (item.kind === "tool") return item.status !== "running";
  return true;
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
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [picker, setPicker] = useState<{ sessions: SessionSummary[]; index: number } | null>(null);
  const { exit } = useApp();
  const sessionId = useRef<string | undefined>(initialSession?.id);
  const abort = useRef<AbortController | null>(null);
  const effortRef = useRef(state.effort);
  effortRef.current = state.effort;

  const busy = state.status === "running" || state.status === "awaiting_permission";
  const pal = palette(draft);
  const palIdx = pal.open ? Math.min(paletteIndex, pal.matches.length - 1) : 0;

  const changeDraft = useCallback((v: string) => {
    setDraft(v);
    setPaletteIndex(0);
  }, []);

  const openResume = useCallback(async () => {
    const sessions = await runtime.listSessions();
    setPicker({ sessions, index: 0 });
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
              "/resume · /effort <level> · /reasoning <hidden|summary|full> · /clear · /help · /exit. Say 'ultrathink' to push a turn to max effort. ↑↓ to pick a command; Esc interrupts; Ctrl+C quits.",
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
      if (busy) return;

      // Enter while the palette is open: run a no-arg command, or complete one that takes an arg.
      const p = palette(value);
      if (p.open && p.matches.length) {
        const cmd = p.matches[Math.min(paletteIndex, p.matches.length - 1)]!;
        setPaletteIndex(0);
        if (cmd.argHint) {
          setDraft(`/${cmd.name} `);
          return;
        }
        setDraft("");
        await execSlash(cmd.name, "");
        return;
      }

      const text = value.trim();
      setDraft("");
      if (!text) return;
      if (text.startsWith("/")) {
        const m = /^\/(\S+)\s*(.*)$/.exec(text);
        if (m) await execSlash(m[1]!, m[2]!.trim());
        return;
      }

      // A real prompt.
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
    [busy, paletteIndex, execSlash, runtime],
  );

  useInput((input, key) => {
    // 1) Permission approval takes the keyboard.
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

    // 2) Session picker (rendered instead of the input, so only this handler is live).
    if (picker) {
      if (key.upArrow) setPicker((p) => (p ? { ...p, index: Math.max(0, p.index - 1) } : p));
      else if (key.downArrow) setPicker((p) => (p ? { ...p, index: Math.min(p.sessions.length - 1, p.index + 1) } : p));
      else if (key.return && picker.sessions.length) void openSession(picker.sessions[picker.index]!);
      else if (key.escape) setPicker(null);
      return;
    }

    // 3) Command-palette navigation (TextInput ignores up/down on a single line, so no conflict).
    if (pal.open) {
      if (key.upArrow) {
        setPaletteIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setPaletteIndex((i) => Math.min(pal.matches.length - 1, i + 1));
        return;
      }
    }

    // 4) Global keys.
    if (key.escape && abort.current) abort.current.abort();
    if (key.ctrl && input === "c") exit();
  });

  const finalized = state.items.filter(isFinalized);
  const live = state.items.filter((i) => !isFinalized(i));
  const ghost = argGhost(draft);

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
          <>
            <Box marginTop={1}>
              <Text color={theme.accent}>{"❯ "}</Text>
              <TextInput value={draft} onChange={changeDraft} onSubmit={submit} placeholder="Ask, or /help" />
              {ghost ? <Text color={theme.faint}>{ghost}</Text> : null}
            </Box>
            {pal.open ? <CommandPalette matches={pal.matches} index={palIdx} /> : null}
          </>
        )}

        <StatusBar state={state} />
      </Box>
    </Box>
  );
}
