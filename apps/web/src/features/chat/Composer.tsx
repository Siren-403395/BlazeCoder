import { useState } from "react";

const EXAMPLES = ["Build a 2048 game", "Create a todo app", "Make a pomodoro timer", "A BMI calculator"];

export function Composer({ disabled, onSubmit }: { disabled: boolean; onSubmit: (prompt: string) => void }) {
  const [value, setValue] = useState("");

  function submit() {
    const prompt = value.trim();
    if (!prompt || disabled) return;
    onSubmit(prompt);
    setValue("");
  }

  return (
    <div className="composer">
      <textarea
        className="composer-input"
        placeholder="Describe the app you want to build…"
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      />
      <div className="composer-row">
        <div className="examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip" disabled={disabled} onClick={() => setValue(ex)}>
              {ex}
            </button>
          ))}
        </div>
        <button className="run-btn" disabled={disabled || !value.trim()} onClick={submit}>
          {disabled ? "Running…" : "Build ▸"}
        </button>
      </div>
    </div>
  );
}
