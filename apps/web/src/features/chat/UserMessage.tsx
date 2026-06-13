import { User } from "@phosphor-icons/react";

export function UserMessage({ text }: { text: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-subtle">
        <User size={12} weight="fill" />
        You
      </div>
      <div className="rounded-card bg-surface-2 px-3.5 py-2.5 text-[13px] leading-relaxed text-text whitespace-pre-wrap">
        {text}
      </div>
    </div>
  );
}
