import { cn } from "@/lib/cn";

/** Monospace, scrollable code/output surface. */
export function CodeBlock({
  code,
  wrap = false,
  className,
}: {
  code: string;
  wrap?: boolean;
  className?: string;
}) {
  return (
    <pre
      className={cn(
        "overflow-auto rounded-card bg-bg-elevated p-3 font-mono text-[12px] leading-relaxed text-muted",
        wrap && "whitespace-pre-wrap break-words",
        className,
      )}
    >
      <code>{code}</code>
    </pre>
  );
}
