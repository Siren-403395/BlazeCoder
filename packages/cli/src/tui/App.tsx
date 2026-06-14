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
import { Box, Static, useApp, useInput, useStdout } from "ink";
import {
  EFFORTS,
  escalateFromPrompt,
  expandSkillBody,
  isEffort,
  type AgentRuntime,
  type Effort,
  type OutputStyle,
  type SessionState,
  type SessionSummary,
  type Skill,
} from "@zephyrcode/core";
import { applyEvent, initialState, splitItems } from "./state";
import { argGhost, atToken, filterFiles, findCommand, palette } from "./commands";
import { ChoicePicker, CommandPalette, FileCompletion, InputBox, ItemView, LoadingLine, PermissionPrompt, SessionPicker, TipLine, TodoPanel, WelcomeBanner } from "./view";
import { freshSeed, loadingWord, tipAt } from "./flavor";

/** Clear screen + scrollback + home the cursor — issued before a /resume or /clear repaints. */
const CLEAR_SCREEN = "\x1b[2J\x1b[3J\x1b[H";

type Completion =
  | { kind: "command"; matches: { name: string; argHint?: string }[] }
  | { kind: "file"; matches: string[]; start: number };

/** A modal list overlay. All three share the picker slot + the one useInput branch. */
type Picker =
  | { kind: "session"; items: SessionSummary[]; index: number }
  | { kind: "skill"; items: Skill[]; index: number }
  | { kind: "style"; items: OutputStyle[]; index: number };

/** Sentinel style row that reverts to the base prompt (selected → setOutputStyle(undefined)). */
const NO_STYLE: OutputStyle = { name: "(default)", description: "no style · base zephyrcode prompt", prompt: "" };

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
    // Mirror the runtime's startup output style so the input rule shows it from frame one.
    const base = { ...initialState(effort), outputStyle: runtime.outputStyle };
    return initialSession ? applyEvent(base, { type: "hydrate", session: initialSession }) : base;
  });
  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState(0);
  const [compIndex, setCompIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  // True while a user-initiated /compact is running (no active turn, but still "working").
  const [compacting, setCompacting] = useState(false);
  // One picker slot, one priority position in useInput; the kind drives Enter's action.
  const [picker, setPicker] = useState<Picker | null>(null);
  const { exit } = useApp();
  const { stdout } = useStdout();
  const width = Math.max(40, stdout?.columns ?? 80);

  const sessionId = useRef<string | undefined>(initialSession?.id);
  const abort = useRef<AbortController | null>(null);
  // Synchronous mirror of `compacting`: set the instant /compact starts (before the
  // await), so useInput blocks editing/steering immediately — the `compacting` state
  // only reaches the handler on the next render, which would leave a race window.
  const compactingRef = useRef(false);
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
  // "Working" covers both a running turn and a manual /compact (which has no turn status).
  const working = busy || compacting;
  // The elapsed clock drives the (only) animated line. It must NOT run while a permission
  // prompt is up: there is nothing to animate there, and the 1s repaints re-anchor the
  // viewport and fight the user's scroll (the prompt would feel pinned to the top).
  const ticking = (state.status === "running" || compacting) && !state.permission;

  // Tick a one-second clock while actively working, for the elapsed time + verb rotation.
  useEffect(() => {
    if (!ticking) return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

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
    setPicker({ kind: "session", items: await runtime.listSessions(), index: 0 });
  }, [runtime]);

  const openSession = useCallback(
    async (summary: SessionSummary) => {
      const s = await runtime.getSession(summary.id);
      if (s) {
        stdout?.write(CLEAR_SCREEN); // wipe the current screen so the resumed transcript replaces, not stacks
        dispatch({ type: "hydrate", session: s });
        sessionId.current = s.id;
      }
      setPicker(null);
    },
    [runtime, stdout],
  );

  // Switch the active output style on the runtime (takes effect next turn) and mirror it
  // in the UI. The sentinel "(default)" row reverts to the base prompt.
  const applyStyle = useCallback(
    (style: OutputStyle) => {
      const real = style.name === NO_STYLE.name ? undefined : style;
      runtime.setOutputStyle(real);
      dispatch({ type: "set_output_style", style: real?.name });
      dispatch({
        type: "notice",
        level: "info",
        message: real ? `Output style → ${real.name} (applies next turn)` : "Output style cleared (base prompt)",
      });
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
          stdout?.write(CLEAR_SCREEN); // wipe the screen so the fresh session starts clean
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
        case "compact": {
          if (!sessionId.current) {
            dispatch({ type: "notice", level: "info", message: "Nothing to compact yet — start a conversation first." });
            return;
          }
          compactingRef.current = true; // block input synchronously, before the await
          setCompacting(true);
          setElapsed(0);
          const ac = new AbortController();
          abort.current = ac;
          try {
            const outcome = await runtime.compact(sessionId.current, (e) => dispatch(e), ac.signal);
            if (outcome.status === "empty") {
              dispatch({ type: "notice", level: "info", message: "Nothing to compact yet — start a conversation first." });
            } else if (outcome.status === "noop") {
              dispatch({ type: "notice", level: "info", message: "Already compact — the conversation is short enough that there's nothing to free." });
            } else {
              dispatch({
                type: "notice",
                level: "info",
                message: `Compacted: ${formatTokens(outcome.tokensBefore)} → ${formatTokens(outcome.tokensAfter)} tokens.`,
              });
            }
          } catch (err) {
            dispatch({
              type: "notice",
              level: ac.signal.aborted ? "info" : "error",
              message: ac.signal.aborted ? "Compaction interrupted." : err instanceof Error ? err.message : String(err),
            });
          } finally {
            abort.current = null;
            compactingRef.current = false;
            setCompacting(false);
          }
          return;
        }
        case "resume":
          await openResume();
          return;
        case "skill":
          if (runtime.skills.length === 0) {
            dispatch({
              type: "notice",
              level: "warn",
              message: "No skills found. Add one under .zephyrcode/skills/<name>/SKILL.md (or ~/.zephyrcode/skills).",
            });
          } else {
            setPicker({ kind: "skill", items: runtime.skills, index: 0 });
          }
          return;
        case "output-style": {
          if (runtime.outputStyles.length === 0) {
            dispatch({
              type: "notice",
              level: "warn",
              message: "No output styles found. Add one under .zephyrcode/output-styles/<name>.md (or ~/.zephyrcode/output-styles).",
            });
            return;
          }
          if (arg) {
            // Direct switch: /output-style <name> (default|none|off reverts to the base prompt).
            const target = /^(default|none|off)$/i.test(arg) ? NO_STYLE : runtime.outputStyles.find((s) => s.name === arg);
            if (target) applyStyle(target);
            else dispatch({ type: "notice", level: "warn", message: `Unknown output style: ${arg}` });
          } else {
            setPicker({ kind: "style", items: [NO_STYLE, ...runtime.outputStyles], index: 0 });
          }
          return;
        }
        case "help":
          dispatch({
            type: "notice",
            level: "info",
            message:
              "/resume · /effort <low|high|ultra> · /skill · /output-style · /usage · /context · /compact · /clear · /help · /exit. Type @ to reference a file, Tab to complete, ↑ for history. Say 'ultrathink' to push a turn to max effort. Esc interrupts; Ctrl+C quits.",
          });
          return;
        default:
          dispatch({ type: "notice", level: "warn", message: `Unknown command: /${name}` });
      }
    },
    [exit, openResume, applyStyle, runtime, stdout],
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
    // Newline insertion for multi-line prompts. Shift+Enter / Option(Meta)+Enter work on
    // terminals that send a distinct sequence; a trailing "\" + Enter is the universal
    // fallback that works everywhere. Shared by the steering (busy) and editing paths.
    const insertNewline = () => setLine(draft.slice(0, cursor) + "\n" + draft.slice(cursor), cursor + 1);
    const replaceTrailingBackslash = () => setLine(draft.slice(0, cursor - 1) + "\n" + draft.slice(cursor), cursor);
    const wantsNewline = !!key.return && (key.shift || key.meta);
    const wantsBackslashNewline = !!key.return && !key.shift && !key.meta && cursor > 0 && draft[cursor - 1] === "\\";
    // Move the cursor up/down one line within a multi-line draft, preserving the column.
    const moveCursorVertical = (dir: number) => {
      const lines = draft.split("\n");
      let row = 0;
      let col = cursor;
      while (row < lines.length - 1 && col > lines[row]!.length) {
        col -= lines[row]!.length + 1;
        row++;
      }
      const target = row + dir;
      if (target < 0 || target >= lines.length) return;
      let base = 0;
      for (let r = 0; r < target; r++) base += lines[r]!.length + 1;
      setCursor(base + Math.min(col, lines[target]!.length));
    };

    // 1) Permission approval. Ctrl+C (quit) and Esc (deny + unblock) MUST be handled here —
    //    this branch returns for every key, so without these the global quit/abort handlers
    //    below are unreachable and the user is trapped while a prompt is up.
    if (state.status === "awaiting_permission" && state.permission) {
      const { requestId: reqId, suggestions } = state.permission;
      if (key.ctrl && input === "c") {
        exit();
        return;
      }
      const remember = (destination: "local" | "project") => {
        if (suggestions?.length) {
          runtime.persistPermission({ type: "addRules", behavior: "allow", rules: suggestions, destination });
        }
        runtime.resolvePermission(reqId, { behavior: "allow" });
        dispatch({ type: "permission_resolved" });
      };
      if (input === "y") {
        runtime.resolvePermission(reqId, { behavior: "allow" });
        dispatch({ type: "permission_resolved" });
      } else if (input === "a") {
        remember("local"); // always allow — this project, gitignored
      } else if (input === "A") {
        remember("project"); // always allow — committable project rule
      } else if (input === "n" || key.escape) {
        // Esc == deny: resolve the pending request so the loop unblocks cleanly.
        runtime.resolvePermission(reqId, { behavior: "deny", message: "Denied by the user." });
        dispatch({ type: "permission_resolved" });
      }
      return;
    }

    // 2) Picker (resume / skill / output-style): one block, Enter action by kind.
    if (picker) {
      if (key.upArrow) setPicker((p) => (p ? { ...p, index: Math.max(0, p.index - 1) } : p));
      else if (key.downArrow) setPicker((p) => (p ? { ...p, index: Math.min(p.items.length - 1, p.index + 1) } : p));
      else if (key.return && picker.items.length) {
        if (picker.kind === "session") void openSession(picker.items[picker.index]!);
        else if (picker.kind === "skill") {
          const skill = picker.items[picker.index]!;
          setPicker(null);
          void submit(expandSkillBody(skill)); // run the recipe as a turn (Claude-Code-style expansion)
        } else {
          applyStyle(picker.items[picker.index]!);
        }
      } else if (key.escape) setPicker(null);
      return;
    }

    // 3) Working: Esc interrupts, Ctrl+C quits. A running turn lets Enter queue a
    //    steering message and other keys fall through to type it; a manual /compact
    //    swallows all other keys (there is no turn to steer). compactingRef is the
    //    synchronous truth — it's set before the await, so there is no stale-state
    //    window in which a prompt could submit and clobber the in-flight compaction.
    if (busy || compactingRef.current) {
      if (key.escape && abort.current) {
        abort.current.abort();
        return;
      }
      if (key.ctrl && input === "c") {
        exit();
        return;
      }
      if (compactingRef.current) return; // no steering/editing while compacting
      if (key.return) {
        if (wantsNewline) {
          insertNewline();
          return;
        }
        if (wantsBackslashNewline) {
          replaceTrailingBackslash();
          return;
        }
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
      if (wantsNewline) {
        insertNewline();
        return;
      }
      if (wantsBackslashNewline) {
        replaceTrailingBackslash();
        return;
      }
      void submit(draft);
      return;
    }
    if (key.tab || input === "\t") {
      accept();
      return;
    }
    if (key.upArrow) {
      if (completion) setCompIndex((i) => Math.max(0, i - 1));
      else if (draft.includes("\n")) moveCursorVertical(-1); // navigate rows within a multi-line draft
      else historyUp();
      return;
    }
    if (key.downArrow) {
      if (completion) setCompIndex((i) => Math.min(completion.matches.length - 1, i + 1));
      else if (draft.includes("\n")) moveCursorVertical(1);
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

  // Split the transcript: finalized items are COMMITTED to <Static> (printed once, they
  // scroll into the terminal's native history — no repaint, no flicker, and the user can
  // scroll up), while the live tail (a streaming reply / running tools) repaints in the
  // small dynamic region below. This is the fix for the whole-screen flicker + viewport-
  // locked-to-bottom problem of rendering the entire transcript dynamically every frame.
  const { committed, live } = splitItems(state.items);

  // Live "working…" line content. A manual /compact has its own steady label (no
  // streaming tokens, no per-tool phase) so it doesn't borrow the turn verbs.
  const tokens = Math.round(state.turnChars / 4);
  const runningTool = [...state.items].reverse().find((i) => i.kind === "tool" && i.status === "running");
  const phase = runningTool && runningTool.kind === "tool" ? `running ${runningTool.name}` : "thinking";
  const word = compacting ? "compacting" : loadingWord(wordSeed.current, Math.floor(elapsed / 3));
  const meta = compacting
    ? `${formatElapsed(elapsed)} · summarizing the conversation to free up context`
    : `${formatElapsed(elapsed)} · ↓ ${formatTokens(tokens)} tokens · ${phase} at ${state.effort} effort`;
  const tip = tipAt(tipIndex.current);

  return (
    <Box flexDirection="column">
      {/* Committed scrollback: printed once into native terminal history, re-keyed on
          /resume + /clear (the screen is wiped first) so a new transcript never stacks. */}
      <Static key={state.epoch} items={committed}>
        {(item) => <ItemView key={item.id} item={item} />}
      </Static>

      {state.items.length === 0 ? (
        <WelcomeBanner model={runtime.model} cwd={prettyPath(runtime.cwd)} effort={state.effort} width={width} />
      ) : state.permission ? (
        // While a permission prompt is up, suppress the live tail. Otherwise that tail (the
        // still-running tool + any streamed reply) is repainted under the modal every frame,
        // and when it is taller than the viewport Ink keeps re-anchoring the screen to its top
        // — which is what made the prompt feel pinned and unscrollable. The prompt itself
        // shows the tool + input being requested, so no context is lost.
        null
      ) : (
        live.map((item) => <ItemView key={item.id} item={item} />)
      )}

      {!picker && !state.permission ? <TodoPanel todos={state.todos} /> : null}

      {working && !state.permission && !picker ? <LoadingLine word={word} meta={meta} /> : null}

      {picker?.kind === "session" ? (
        <SessionPicker sessions={picker.items} index={picker.index} />
      ) : picker?.kind === "skill" ? (
        <ChoicePicker title="Run a skill" items={picker.items} index={picker.index} />
      ) : picker?.kind === "style" ? (
        <ChoicePicker title="Set output style" items={picker.items} index={picker.index} />
      ) : state.permission ? (
        <PermissionPrompt p={state.permission} />
      ) : (
        <Box flexDirection="column">
          <InputBox
            value={draft}
            cursor={cursor}
            ghost={ghost}
            placeholder={
              compacting
                ? "compacting… (esc to interrupt)"
                : busy
                  ? "working… (type + enter to steer · esc to interrupt)"
                  : "Ask, or / for commands, @ for files"
            }
            effort={state.effort}
            outputStyle={state.outputStyle}
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
