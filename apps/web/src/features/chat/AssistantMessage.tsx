import { type ReactNode } from "react";
import { Robot } from "@phosphor-icons/react";
import { CodeBlock } from "@/ui";

/** Split inline `code` spans into mono fragments; everything else is prose. */
function renderInline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
      return (
        <code key={i} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-accent-text">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

/** Lightweight renderer: fenced ``` blocks become CodeBlocks, the rest is prose. */
function renderBody(text: string): ReactNode[] {
  return text.split(/```(?:[\w-]*\n)?/g).map((chunk, i) => {
    if (i % 2 === 1) {
      return <CodeBlock key={i} code={chunk.replace(/\n$/, "")} wrap />;
    }
    if (!chunk.trim()) return null;
    return (
      <p key={i} className="whitespace-pre-wrap">
        {renderInline(chunk)}
      </p>
    );
  });
}

export function AssistantMessage({ text }: { text: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-accent-text">
        <Robot size={13} weight="fill" />
        Agent
      </div>
      <div className="space-y-2 text-[13px] leading-relaxed text-text">{renderBody(text)}</div>
    </div>
  );
}
