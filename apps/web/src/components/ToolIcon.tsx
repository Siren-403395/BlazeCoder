import type { ComponentType } from "react";
import {
  Asterisk,
  Brain,
  Browser,
  FilePlus,
  FileText,
  FolderOpen,
  MagnifyingGlass,
  PencilSimple,
  Terminal,
  Trash,
  Wrench,
  type IconProps,
} from "@phosphor-icons/react";
import type { ToolIconKey } from "@/lib/toolMeta";

// Domain-aware component (keyed by the agent's tool vocabulary), so it lives in
// the components layer rather than the domain-free @/ui primitives.
const MAP: Record<ToolIconKey, ComponentType<IconProps>> = {
  list: FolderOpen,
  read: FileText,
  write: FilePlus,
  edit: PencilSimple,
  delete: Trash,
  search: MagnifyingGlass,
  glob: Asterisk,
  preview: Browser,
  shell: Terminal,
  memory: Brain,
  tool: Wrench,
};

/** Resolves a tool icon key to a Phosphor glyph. */
export function ToolIcon({ name, ...rest }: { name: ToolIconKey } & IconProps) {
  const Glyph = MAP[name];
  return <Glyph {...rest} />;
}
