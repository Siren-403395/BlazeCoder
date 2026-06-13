import { FolderOpen } from "@phosphor-icons/react";
import type { UiFile } from "@/lib/agentState";
import { EmptyState } from "@/ui";
import { FileExplorer } from "./FileExplorer";
import { FileViewer } from "./FileViewer";

/** Files tab: directory tree on the left, code/diff viewer on the right. */
export function FilesView({
  files,
  selected,
  onSelect,
}: {
  files: UiFile[];
  selected?: string;
  onSelect: (path: string) => void;
}) {
  if (files.length === 0) {
    return (
      <EmptyState
        icon={<FolderOpen size={28} weight="regular" />}
        title="No files yet"
        hint="Generated files appear here as the agent writes them."
      />
    );
  }

  const active = selected ? files.find((f) => f.path === selected) : undefined;

  return (
    <div className="flex h-full min-h-0">
      <div className="w-[220px] shrink-0 overflow-auto border-r border-border">
        <FileExplorer files={files} selected={selected} onSelect={onSelect} />
      </div>
      <div className="min-w-0 flex-1">
        <FileViewer key={active?.path ?? "none"} file={active} />
      </div>
    </div>
  );
}
