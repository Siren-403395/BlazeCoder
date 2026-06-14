import { useEffect } from "react";
import { Check, ShieldAlert, X } from "lucide-react";
import type { RuleSource } from "@zephyrcode/shared";
import type { PermissionPrompt } from "../app/types";
import { stringifyInput } from "../app/format";

export function PermissionDialog({
  prompt,
  onResolve,
}: {
  prompt: PermissionPrompt;
  onResolve: (behavior: "allow" | "deny", persist?: RuleSource) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onResolve("deny");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onResolve]);

  const canPersist = prompt.suggestions.length > 0;

  return (
    <div className="overlay">
      <section className="dialog" role="dialog" aria-modal="true" aria-label="Permission required">
        <header className="dialog__head">
          <span className={`dialog__icon ${prompt.risk?.level === "destructive" ? "is-danger" : ""}`}>
            <ShieldAlert size={18} strokeWidth={1.75} />
          </span>
          <div>
            <div className="dialog__eyebrow">Permission required</div>
            <h2 className="dialog__title">{prompt.toolName}</h2>
          </div>
          {prompt.risk ? <span className={`risk risk--${prompt.risk.level}`}>{prompt.risk.level}</span> : null}
        </header>

        <p className="dialog__reason">{prompt.reason}</p>
        {prompt.risk ? <p className="dialog__risk">{prompt.risk.reason}</p> : null}

        <pre className="code dialog__input">{stringifyInput(prompt.input)}</pre>

        {canPersist ? (
          <div className="dialog__rules">
            {prompt.suggestions.map((rule) => (
              <code key={rule} className="chip">
                {rule}
              </code>
            ))}
          </div>
        ) : null}

        <div className="dialog__actions">
          <button className="btn btn--danger" onClick={() => onResolve("deny")}>
            <X size={15} strokeWidth={2} />
            Deny
          </button>
          <button className="btn btn--primary" onClick={() => onResolve("allow")}>
            <Check size={15} strokeWidth={2} />
            Allow once
          </button>
        </div>

        {canPersist ? (
          <div className="dialog__persist">
            <span className="dialog__persist-label">Always allow in</span>
            {(["local", "project", "user"] as const).map((scope) => (
              <button key={scope} className="btn btn--ghost btn--sm" onClick={() => onResolve("allow", scope)}>
                {scope}
              </button>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
