import { useEffect, useRef, useState } from "react";
import { ArrowUp, Brain, Stop } from "@phosphor-icons/react";
import { Button, IconButton, Kbd } from "@/ui";
import { cn } from "@/lib/cn";

const EXAMPLES = ["Build a 2048 game", "A pomodoro timer", "Markdown note app"];

export function Composer({
  busy,
  onSubmit,
  onStop,
}: {
  busy: boolean;
  onSubmit: (prompt: string, thinking: boolean) => void;
  onStop: () => void;
}) {
  const [value, setValue] = useState("");
  // Deep-thinking is a sticky chat preference, persisted across reloads.
  const [thinking, setThinking] = useState(
    () => typeof localStorage !== "undefined" && localStorage.getItem("ca-thinking") === "1",
  );
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem("ca-thinking", thinking ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [thinking]);

  function grow() {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  function submit() {
    const prompt = value.trim();
    if (!prompt || busy) return;
    onSubmit(prompt, thinking);
    setValue("");
    requestAnimationFrame(() => {
      if (ref.current) ref.current.style.height = "auto";
    });
  }

  return (
    <div className="relative z-10 shrink-0 chrome-bottom px-5 pb-5 pt-4">
      {!value && !busy && (
        <div className="mb-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <Button
              key={ex}
              variant="subtle"
              size="sm"
              onClick={() => {
                setValue(ex);
                requestAnimationFrame(() => {
                  ref.current?.focus();
                  grow();
                });
              }}
            >
              {ex}
            </Button>
          ))}
        </div>
      )}

      <div className="relative">
        <textarea
          ref={ref}
          value={value}
          aria-label="Message the agent"
          placeholder="Describe the app to build, or a change to make..."
          rows={2}
          onChange={(e) => {
            setValue(e.target.value);
            grow();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          className={cn(
            "block max-h-[200px] min-h-[72px] w-full resize-none rounded-card border border-border bg-bg",
            "px-4 py-3.5 pr-14 text-[13px] leading-relaxed text-text outline-none",
            "shadow-[var(--inset-well)] transition-shadow",
            "placeholder:text-faint focus:border-accent-border focus:shadow-[var(--well-focus)]",
          )}
        />
        {busy ? (
          <IconButton
            label="Stop the run"
            variant="subtle"
            onClick={onStop}
            className="absolute bottom-3 right-3 size-9"
          >
            <Stop size={15} weight="fill" />
          </IconButton>
        ) : (
          <Button
            aria-label="Send"
            variant="primary"
            onClick={submit}
            disabled={!value.trim()}
            className="absolute bottom-3 right-3 size-9 p-0"
          >
            <ArrowUp size={16} weight="bold" />
          </Button>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setThinking((v) => !v)}
          aria-pressed={thinking}
          title="Let the model reason step by step before answering"
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-control border px-2.5 text-[12px] transition-colors",
            thinking
              ? "border-accent-border bg-accent-subtle text-accent-text"
              : "border-border text-muted hover:border-border-strong hover:text-text",
          )}
        >
          <Brain size={14} weight={thinking ? "fill" : "regular"} />
          Deep thinking
        </button>
        <div className="flex items-center gap-1.5 text-[11px] text-faint">
          <Kbd>⌘</Kbd>
          <Kbd>↵</Kbd>
          <span>to send</span>
        </div>
      </div>
    </div>
  );
}
