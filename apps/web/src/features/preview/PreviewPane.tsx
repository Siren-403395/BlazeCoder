import { useCallback, useState } from "react";
import { ArrowClockwise, ArrowSquareOut, Browser, WarningCircle } from "@phosphor-icons/react";
import { CodeBlock, EmptyState, IconButton, Skeleton, Spinner } from "@/ui";

/**
 * Live preview of the agent's running app.
 * Renders the built HTML in a sandboxed iframe, with explicit
 * error / building / empty states ahead of the happy path.
 */
export function PreviewPane({
  html,
  error,
  building,
}: {
  html?: string;
  error?: string;
  building?: boolean;
}) {
  // Bumping the nonce remounts the iframe (via key) to force a fresh reload.
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const openInNewTab = useCallback(() => {
    if (!html) return;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    window.open(url);
    // Defer revoke so the opened tab has time to load before the URL is freed.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, [html]);

  // 1) Build error takes priority over everything.
  if (error) {
    return (
      <div role="alert" className="flex h-full flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
          <WarningCircle size={15} weight="regular" className="text-danger-text" />
          <span className="text-sm font-medium text-danger-text">Build failed</span>
        </div>
        <CodeBlock code={error} wrap className="m-0 min-h-0 flex-1 rounded-none border-0 bg-bg" />
      </div>
    );
  }

  // 2) Building with nothing to show yet.
  if (building && !html) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 py-12">
        <div className="flex items-center gap-2">
          <Spinner size={14} />
          <span className="text-sm text-muted">Building preview</span>
        </div>
        <Skeleton className="h-[70%] w-[70%] rounded-card" />
      </div>
    );
  }

  // 3) Nothing built yet.
  if (!html) {
    return (
      <EmptyState
        icon={<Browser size={28} />}
        title="No preview yet"
        hint="Ask the agent to build something and the running app shows up here."
      />
    );
  }

  // 4) Happy path: render the live app.
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <span className="inline-flex h-6 items-center rounded-control bg-surface-2 px-2 font-mono text-[11px] text-subtle">
          localhost:5173
        </span>
        <div className="flex items-center gap-1">
          <IconButton label="Reload preview" size="sm" onClick={reload}>
            <ArrowClockwise size={15} weight="regular" />
          </IconButton>
          <IconButton label="Open in new tab" size="sm" onClick={openInNewTab}>
            <ArrowSquareOut size={15} weight="regular" />
          </IconButton>
        </div>
      </div>
      <iframe
        key={nonce}
        className="min-h-0 w-full flex-1 border-0 bg-white"
        title="App preview"
        // allow-same-origin is required so generated apps can use localStorage /
        // sessionStorage (common: theme, scores, drafts). Acceptable for a local
        // tool previewing its own generated code.
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        srcDoc={html}
      />
    </div>
  );
}
