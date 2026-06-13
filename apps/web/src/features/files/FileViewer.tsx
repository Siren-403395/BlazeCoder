import { useState } from "react";
import { FileText } from "@phosphor-icons/react";
import type { UiFile } from "@/lib/agentState";
import { CodeBlock, EmptyState, SegmentedControl } from "@/ui";
import { DiffView } from "./DiffView";

type ViewMode = "code" | "diff";

const MODE_OPTIONS = [
  { value: "code" as const, label: "Code" },
  { value: "diff" as const, label: "Diff" },
];

/** Code / diff view for the file selected in the explorer. */
export function FileViewer({ file }: { file?: UiFile }) {
  // FilesView keys this component by file path, so each new file mounts fresh
  // in "code" mode (no stale-diff flash); content updates to the same file
  // preserve the chosen mode.
  const [mode, setMode] = useState<ViewMode>("code");

  if (!file) {
    return (
      <EmptyState
        icon={<FileText size={28} weight="regular" />}
        title="Select a file"
        hint="Pick a file from the tree to view it."
      />
    );
  }

  const hasDiff = file.prevContent !== undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted">
          {file.path}
        </span>
        {hasDiff && (
          <SegmentedControl<ViewMode>
            value={mode}
            options={MODE_OPTIONS}
            onChange={setMode}
            ariaLabel="File view mode"
            layoutId="file-view-mode"
          />
        )}
      </header>
      <div className="min-h-0 flex-1">
        {mode === "diff" && hasDiff ? (
          <DiffView prev={file.prevContent ?? ""} next={file.content} />
        ) : (
          <CodeBlock code={file.content} className="h-full rounded-none border-0 bg-bg" />
        )}
      </div>
    </div>
  );
}
