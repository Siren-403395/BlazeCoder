import { useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import type { RunStatus } from "../app/types";

export function Composer({
  status,
  ready,
  onSend,
  onAbort,
}: {
  status: RunStatus;
  ready: boolean;
  onSend: (text: string) => void;
  onAbort: () => void;
}) {
  const [text, setText] = useState("");
  const idle = status === "idle";

  function send() {
    const value = text.trim();
    if (!value || !idle || !ready) return;
    onSend(value);
    setText("");
  }

  return (
    <div className="composer">
      <textarea
        className="composer__input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            send();
          }
        }}
        placeholder={ready ? "Ask blazecoder to inspect, change, test, or explain…  (⌘/Ctrl+Enter to send)" : "Open a workspace to begin"}
        disabled={!ready}
        rows={1}
      />
      {idle ? (
        <button className="composer__send" onClick={send} disabled={!ready || !text.trim()} aria-label="Send">
          <ArrowUp size={17} strokeWidth={2.25} />
        </button>
      ) : (
        <button className="composer__stop" onClick={onAbort} aria-label="Stop">
          <Square size={14} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
