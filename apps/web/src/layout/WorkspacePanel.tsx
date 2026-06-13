import { Browser, Files, ListBullets } from "@phosphor-icons/react";
import { Badge, PanelHeader, SegmentedControl, type Segment } from "@/ui";
import type { TraceEntry, UiFile } from "@/lib/agentState";
import { PreviewPane } from "@/features/preview/PreviewPane";
import { FilesView } from "@/features/files/FilesView";
import { TracePanel } from "@/features/trace/TracePanel";

export type WorkTab = "preview" | "files" | "trace";

export function WorkspacePanel({
  tab,
  onTab,
  previewHtml,
  previewError,
  building,
  files,
  selected,
  onSelect,
  trace,
}: {
  tab: WorkTab;
  onTab: (tab: WorkTab) => void;
  previewHtml?: string;
  previewError?: string;
  building: boolean;
  files: UiFile[];
  selected?: string;
  onSelect: (path: string) => void;
  trace: TraceEntry[];
}) {
  const options: Segment<WorkTab>[] = [
    { value: "preview", label: "Preview", icon: <Browser size={14} /> },
    {
      value: "files",
      label: "Files",
      icon: <Files size={14} />,
      badge: files.length > 0 ? <Count n={files.length} /> : undefined,
    },
    { value: "trace", label: "Trace", icon: <ListBullets size={14} /> },
  ];

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      <PanelHeader>
        <SegmentedControl
          ariaLabel="Workspace view"
          layoutId="workspace-tab"
          value={tab}
          onChange={onTab}
          options={options}
        />
      </PanelHeader>
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === "preview" && (
          <PreviewPane html={previewHtml} error={previewError} building={building} />
        )}
        {tab === "files" && <FilesView files={files} selected={selected} onSelect={onSelect} />}
        {tab === "trace" && <TracePanel trace={trace} />}
      </div>
    </section>
  );
}

function Count({ n }: { n: number }) {
  return (
    <Badge tone="neutral" mono className="ml-0.5">
      {n}
    </Badge>
  );
}
