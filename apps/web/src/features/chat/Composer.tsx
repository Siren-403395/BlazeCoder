import { useRef, useState } from "react";
import { ArrowUp, Stop } from "@phosphor-icons/react";
import { Button, IconButton, Kbd } from "@/ui";
import { cn } from "@/lib/cn";

const EXAMPLES = ["Build a 2048 game", "A pomodoro timer", "Markdown note app", "BMI calculator"];

export function Composer({
  busy,
  onSubmit,
  onStop,
}: {
  busy: boolean;
  onSubmit: (prompt: string) => void;
  onStop: () => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  function grow() {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  function submit() {
    const prompt = value.trim();
    if (!prompt || busy) return;
    onSubmit(prompt);
    setValue("");
    requestAnimationFrame(() => {
      if (ref.current) ref.current.style.height = "auto";
    });
  }

  return (
    <div className="shrink-0 border-t border-border bg-surface p-3">
      {!value && !busy && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
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
            "block max-h-[200px] min-h-[56px] w-full resize-none rounded-card border border-border bg-bg",
            "px-3.5 py-3 pr-12 text-[13px] leading-relaxed text-text outline-none",
            "placeholder:text-faint focus:border-accent-border",
          )}
        />
        {busy ? (
          <IconButton
            label="Stop the run"
            variant="subtle"
            onClick={onStop}
            className="absolute bottom-2.5 right-2.5 size-8"
          >
            <Stop size={15} weight="fill" />
          </IconButton>
        ) : (
          <Button
            aria-label="Send"
            variant="primary"
            onClick={submit}
            disabled={!value.trim()}
            className="absolute bottom-2.5 right-2.5 size-8 p-0"
          >
            <ArrowUp size={16} weight="bold" />
          </Button>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-faint">
        <Kbd>⌘</Kbd>
        <Kbd>↵</Kbd>
        <span>to send</span>
      </div>
    </div>
  );
}
