import { useMemo, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Info, Scissors, Sparkle, Warning } from "@phosphor-icons/react";
import { EmptyState, StatusDot } from "@/ui";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import type { UiStatus } from "@/lib/agentState";
import type { ConversationSegment } from "@/lib/conversation";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";
import { ActivityItem } from "./ActivityItem";

export function ConversationStream({
  segments,
  phase,
  onOpenFile,
}: {
  segments: ConversationSegment[];
  phase: UiStatus;
  onOpenFile: (path: string) => void;
}) {
  const reduce = useReducedMotion();

  // Re-stick on new segments and when in-flight tools settle.
  const settled = useMemo(
    () =>
      segments.reduce(
        (n, s) => n + (s.kind === "activities" ? s.items.filter((i) => i.status !== "running").length : 0),
        0,
      ),
    [segments],
  );
  const { ref, onScroll } = useAutoScroll(`${segments.length}:${settled}:${phase}`);

  if (segments.length === 0) {
    return (
      <div className="h-full">
        <EmptyState
          icon={<Sparkle size={28} weight="light" />}
          title="Ready to build"
          hint="Describe an app below. The agent will write the files, build a live preview, and fix its own mistakes."
        />
      </div>
    );
  }

  return (
    <div ref={ref} onScroll={onScroll} className="h-full space-y-5 overflow-auto px-4 py-4">
      {segments.map((segment) => (
        <Appear key={segment.id} reduce={!!reduce}>
          <Segment segment={segment} onOpenFile={onOpenFile} />
        </Appear>
      ))}
      {phase === "running" && (
        <div className="flex items-center gap-2 pl-0.5 text-[12px] text-subtle">
          <StatusDot tone="accent" pulse />
          Working
        </div>
      )}
    </div>
  );
}

function Appear({ reduce, children }: { reduce: boolean; children: ReactNode }) {
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

function Segment({
  segment,
  onOpenFile,
}: {
  segment: ConversationSegment;
  onOpenFile: (path: string) => void;
}) {
  switch (segment.kind) {
    case "user":
      return <UserMessage text={segment.text} />;
    case "assistant":
      return <AssistantMessage text={segment.text} />;
    case "activities":
      return (
        <div className="space-y-1.5">
          {segment.items.map((item) => (
            <ActivityItem key={item.id} entry={item} onOpenFile={onOpenFile} />
          ))}
        </div>
      );
    case "compact":
      return (
        <div className="flex items-center gap-2 text-[11px] text-info">
          <span className="h-px flex-1 bg-border" />
          <Scissors size={12} />
          Context compacted
          <span className="h-px flex-1 bg-border" />
        </div>
      );
    case "notice":
      return <NoticeRow level={segment.level} text={segment.text} />;
  }
}

function NoticeRow({ level, text }: { level: "info" | "warn" | "error"; text: string }) {
  const tone =
    level === "error" ? "text-danger-text" : level === "warn" ? "text-warn" : "text-subtle";
  const Icon = level === "info" ? Info : Warning;
  return (
    <div className={`flex items-start gap-1.5 text-[12px] ${tone}`}>
      <Icon size={13} className="mt-0.5 shrink-0" />
      <span className="whitespace-pre-wrap">{text}</span>
    </div>
  );
}
