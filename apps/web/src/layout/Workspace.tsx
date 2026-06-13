import { PanelHeader } from "@/ui";
import { cn } from "@/lib/cn";
import { useResizable } from "@/hooks/useResizable";
import type { PendingPermission, TraceEntry, UiFile, UiStatus } from "@/lib/agentState";
import type { ConversationSegment } from "@/lib/conversation";
import { ConversationStream } from "@/features/chat/ConversationStream";
import { Composer } from "@/features/chat/Composer";
import { PermissionCard } from "@/features/permissions/PermissionCard";
import { WorkspacePanel, type WorkTab } from "./WorkspacePanel";

export function Workspace({
  segments,
  phase,
  onOpenFile,
  busy,
  onRun,
  onStop,
  pending,
  onDecide,
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
  segments: ConversationSegment[];
  phase: UiStatus;
  onOpenFile: (path: string) => void;
  busy: boolean;
  onRun: (prompt: string) => void;
  onStop: () => void;
  pending?: PendingPermission;
  onDecide: (behavior: "allow" | "deny") => void;
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
  const { width, dragging, onPointerDown, onKeyDown, min, max } = useResizable({
    storageKey: "ca-conversation-width",
    initial: 440,
    min: 340,
    max: 680,
    side: "right",
  });

  // Cursor-style layout: the workspace fills the left, the conversation is a
  // resizable right rail. DOM order is left to right.
  return (
    <div className="flex min-h-0 flex-1">
      <WorkspacePanel
        tab={tab}
        onTab={onTab}
        previewHtml={previewHtml}
        previewError={previewError}
        building={building}
        files={files}
        selected={selected}
        onSelect={onSelect}
        trace={trace}
      />

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize conversation panel"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        className="group relative w-1 shrink-0 cursor-col-resize"
      >
        <div
          className={cn(
            "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors",
            dragging
              ? "bg-accent-border"
              : "bg-border group-hover:bg-accent-border group-focus-visible:bg-accent-border",
          )}
        />
      </div>

      <div
        style={{ width }}
        className="flex min-h-0 shrink-0 flex-col border-l border-border bg-surface"
      >
        <PanelHeader className="px-5">Conversation</PanelHeader>
        <div className="min-h-0 flex-1">
          <ConversationStream segments={segments} phase={phase} onOpenFile={onOpenFile} />
        </div>
        {pending && (
          <div className="px-3 pt-3">
            <PermissionCard
              pending={pending}
              onAllow={() => onDecide("allow")}
              onDeny={() => onDecide("deny")}
            />
          </div>
        )}
        <Composer busy={busy} onSubmit={onRun} onStop={onStop} />
      </div>
    </div>
  );
}
