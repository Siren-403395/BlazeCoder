import { ShieldCheck } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import type { PendingPermission } from "@/lib/agentState";
import { toolMeta } from "@/lib/toolMeta";
import { Badge, Button, CodeBlock } from "@/ui";

/**
 * Inline permission prompt the layout renders just above the composer when the
 * agent requests approval for a sensitive tool call. Presentational only: the
 * allow/deny decision is delegated upward via callbacks.
 */
export function PermissionCard({
  pending,
  onAllow,
  onDeny,
}: {
  pending: PendingPermission;
  onAllow: () => void;
  onDeny: () => void;
}) {
  const reduce = useReducedMotion();
  const meta = toolMeta(pending.toolName, pending.input);
  const reason = pending.reason.trim();

  const detail = meta.detail
    ? meta.detail
    : Object.keys(pending.input).length > 0
      ? JSON.stringify(pending.input, null, 2)
      : null;

  return (
    <motion.div
      role="region"
      aria-label="Permission request"
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-2.5 rounded-card border border-accent-border bg-accent-subtle p-3 shadow-pop"
    >
      <div className="flex items-center gap-2">
        <ShieldCheck size={16} weight="bold" className="text-accent-text" />
        <span className="text-sm font-medium text-text">Permission needed</span>
        <Badge tone="accent" mono className="ml-auto">
          {pending.toolName}
        </Badge>
      </div>

      {reason && <p className="text-[12.5px] text-muted">{reason}</p>}

      {detail && <CodeBlock wrap code={detail} />}

      <div className="flex items-center justify-end gap-2">
        <Button variant="danger" size="sm" onClick={onDeny}>
          Deny
        </Button>
        <Button variant="primary" size="sm" onClick={onAllow}>
          Allow
        </Button>
      </div>
    </motion.div>
  );
}
