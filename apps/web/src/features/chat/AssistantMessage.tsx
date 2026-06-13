import { isValidElement, memo, type ReactNode } from "react";
import { Robot } from "@phosphor-icons/react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "@/ui";

/** Pull the text out of a <pre>'s <code> child (react-markdown builds it first). */
function codeText(node: ReactNode): string {
  const child = isValidElement(node) ? node : Array.isArray(node) ? node.find(isValidElement) : null;
  const raw = isValidElement(child) ? (child.props as { children?: ReactNode }).children : node;
  const text =
    typeof raw === "string"
      ? raw
      : Array.isArray(raw)
        ? raw.filter((x): x is string => typeof x === "string").join("")
        : String(raw ?? "");
  return text.replace(/\n+$/, "");
}

/**
 * Renders assistant prose as GitHub-flavored Markdown via react-markdown (no
 * hand-rolled parsing), mapping each node to a token-styled element. Blocks are
 * detected structurally (the `pre` override owns code blocks; `code` is always
 * inline), so a just-opened or language-less fence never flickers as an inline
 * pill mid-stream.
 */
const MD_COMPONENTS: Components = {
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-accent-text underline underline-offset-2 hover:text-accent-hover"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => <h1 className="mt-1 text-base font-semibold tracking-tight">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-1 text-[15px] font-semibold tracking-tight">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-1 text-sm font-semibold tracking-tight">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-1 text-sm font-medium">{children}</h4>,
  strong: ({ children }) => <strong className="font-semibold text-text">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  hr: () => <hr className="my-1 border-border" />,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-3 text-muted">{children}</blockquote>
  ),
  pre: ({ children }) => <CodeBlock code={codeText(children)} wrap />,
  code: ({ children }) => (
    <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-accent-text">
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border bg-surface-2 px-2 py-1 text-left font-medium">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
  img: ({ src, alt }) => {
    const safe = typeof src === "string" && src ? src : undefined;
    if (!safe) return null;
    return <img src={safe} alt={alt} loading="lazy" className="max-w-full rounded-card" />;
  },
};

export const AssistantMessage = memo(function AssistantMessage({ text }: { text: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-accent-text">
        <Robot size={13} weight="fill" />
        Agent
      </div>
      <div className="space-y-2 text-[13px] leading-relaxed text-text">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
          {text}
        </ReactMarkdown>
      </div>
    </div>
  );
});
