/**
 * The root TUI component. Owns the reducer, drives the AgentRuntime in-process
 * (no HTTP), maps its event stream into the reducer, and renders a two-region
 * layout: an immutable <Static> scrollback of finalized turns + a live region for
 * the in-flight assistant, running tools, the prompt, and permission approvals.
 */

import { useCallback, useReducer, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import type { AgentRuntime } from "@coding-agent/core";
import { applyEvent, initialState, type Item, type TuiState } from "./state";
import { ItemView, PermissionPrompt, StatusBar } from "./view";
import { theme } from "./theme";

const EFFORTS = ["low", "medium", "high", "ultra"];

function isFinalized(item: Item): boolean {
  if (item.kind === "assistant") return !item.streaming;
  if (item.kind === "tool") return item.status !== "running";
  return true;
}

function effortToThinking(effort: string): boolean {
  return effort !== "low";
}

export function App({ runtime, effort = "high" }: { runtime: AgentRuntime; effort?: string }) {
  const [state, dispatch] = useReducer(applyEvent, undefined, () => initialState(effort));
  const [draft, setDraft] = useState("");
  const { exit } = useApp();
  const sessionId = useRef<string | undefined>(undefined);
  const abort = useRef<AbortController | null>(null);
  const effortRef = useRef(state.effort);
  effortRef.current = state.effort;

  const busy = state.status === "running" || state.status === "awaiting_permission";

  const handleSlash = useCallback(
    (text: string): boolean => {
      if (!text.startsWith("/")) return false;
      const [cmd, ...rest] = text.slice(1).split(/\s+/);
      const arg = rest.join(" ").trim();
      switch (cmd) {
        case "exit":
        case "quit":
          exit();
          return true;
        case "clear":
          dispatch({ type: "reset" });
          sessionId.current = undefined;
          return true;
        case "effort":
          if (EFFORTS.includes(arg)) dispatch({ type: "set_effort", effort: arg });
          else dispatch({ type: "notice", level: "warn", message: `Usage: /effort <${EFFORTS.join("|")}>` });
          return true;
        case "help":
          dispatch({
            type: "notice",
            level: "info",
            message: "Commands: /effort <level>, /clear, /help, /exit. Esc interrupts a run; Ctrl+C quits.",
          });
          return true;
        default:
          dispatch({ type: "notice", level: "warn", message: `Unknown command: /${cmd}` });
          return true;
      }
    },
    [exit],
  );

  const submit = useCallback(
    async (value: string) => {
      const text = value.trim();
      setDraft("");
      if (!text || busy) return;
      if (handleSlash(text)) return;

      dispatch({ type: "user_prompt", text });
      const ac = new AbortController();
      abort.current = ac;
      try {
        const { session } = await runtime.run(
          { prompt: text, sessionId: sessionId.current, thinking: effortToThinking(effortRef.current) },
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
    [runtime, busy, handleSlash],
  );

  useInput((input, key) => {
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
    if (key.escape && abort.current) abort.current.abort();
    if (key.ctrl && input === "c") exit();
  });

  const finalized = state.items.filter(isFinalized);
  const live = state.items.filter((i) => !isFinalized(i));

  return (
    <Box flexDirection="column">
      <Static items={finalized}>{(item) => <ItemView key={item.id} item={item} />}</Static>

      <Box flexDirection="column">
        {live.map((item) => (
          <ItemView key={item.id} item={item} />
        ))}

        {state.permission ? (
          <PermissionPrompt p={state.permission} />
        ) : busy ? (
          <Box marginTop={1}>
            <Text color={theme.accent}>
              <Spinner type="dots" />
            </Text>
            <Text color={theme.faint}> working… (esc to interrupt)</Text>
          </Box>
        ) : (
          <Box marginTop={1}>
            <Text color={theme.accent}>{"❯ "}</Text>
            <TextInput value={draft} onChange={setDraft} onSubmit={submit} placeholder="Ask, or /help" />
          </Box>
        )}

        <StatusBar state={state} />
      </Box>
    </Box>
  );
}

export type { TuiState };
