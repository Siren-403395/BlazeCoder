import { useState } from "react";
import type { ReactNode } from "react";
import {
  BracketsCurly,
  CaretDown,
  CaretRight,
  FileCode,
  FileCss,
  FileHtml,
  FileText,
  Folder,
} from "@phosphor-icons/react";
import type { UiFile } from "@/lib/agentState";
import { Badge } from "@/ui";
import { basename } from "@/lib/format";
import { cn } from "@/lib/cn";

const INDENT_BASE = 8;
const INDENT_STEP = 12;

/** A node in the directory tree built from the flat POSIX file paths. */
interface FileNode {
  name: string;
  /** Full POSIX path of the file (leaf nodes only). */
  path: string;
  file: UiFile;
}

interface FolderNode {
  name: string;
  /** Full POSIX path of this folder (used as a stable key). */
  path: string;
  folders: FolderNode[];
  files: FileNode[];
}

/** Fold the flat file list into a nested folder tree. */
function buildTree(files: UiFile[]): FolderNode {
  const root: FolderNode = { name: "", path: "", folders: [], files: [] };

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let dir = root;
    // Walk every directory segment, creating folders as needed.
    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i]!;
      let next = dir.folders.find((f) => f.name === segment);
      if (!next) {
        next = { name: segment, path: `${dir.path}/${segment}`, folders: [], files: [] };
        dir.folders.push(next);
      }
      dir = next;
    }
    const leaf = parts[parts.length - 1];
    if (leaf) dir.files.push({ name: leaf, path: file.path, file });
  }

  sortFolder(root);
  return root;
}

/** Folders-first, then files, both alphabetical (recursively). */
function sortFolder(node: FolderNode): void {
  node.folders.sort((a, b) => a.name.localeCompare(b.name));
  node.files.sort((a, b) => a.name.localeCompare(b.name));
  for (const child of node.folders) sortFolder(child);
}

function fileIcon(path: string): ReactNode {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const props = { size: 14, weight: "regular" as const, className: "shrink-0 text-muted" };
  switch (ext) {
    case "tsx":
    case "ts":
    case "jsx":
    case "js":
      return <FileCode {...props} />;
    case "css":
      return <FileCss {...props} />;
    case "html":
      return <FileHtml {...props} />;
    case "json":
      return <BracketsCurly {...props} />;
    case "md":
    case "txt":
      return <FileText {...props} />;
    default:
      return <FileText {...props} />;
  }
}

function FileRow({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: FileNode;
  depth: number;
  selected?: string;
  onSelect: (path: string) => void;
}) {
  const active = node.path === selected;
  const { file } = node;
  const badge =
    file.prevContent !== undefined
      ? "edited"
      : file.lastOp === "write"
        ? "new"
        : null;

  return (
    <button
      type="button"
      role="treeitem"
      aria-level={depth + 1}
      onClick={() => onSelect(node.path)}
      aria-current={active ? "true" : undefined}
      style={{ paddingLeft: depth * INDENT_STEP + INDENT_BASE }}
      className={cn(
        "flex h-7 w-full items-center gap-1.5 rounded-control pr-2 text-left font-mono text-[12.5px]",
        "transition-colors duration-100",
        active ? "bg-accent-subtle text-accent-text" : "text-muted hover:bg-surface-2 hover:text-text",
      )}
    >
      {fileIcon(node.path)}
      <span className="min-w-0 flex-1 truncate">{basename(node.path)}</span>
      {badge && (
        <Badge tone="neutral" className="shrink-0">
          {badge}
        </Badge>
      )}
    </button>
  );
}

function FolderRow({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: FolderNode;
  depth: number;
  selected?: string;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const Caret = open ? CaretDown : CaretRight;

  return (
    <>
      <button
        type="button"
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ paddingLeft: depth * INDENT_STEP + INDENT_BASE }}
        className={cn(
          "flex h-7 w-full items-center gap-1.5 rounded-control pr-2 text-left text-[12.5px] font-medium",
          "text-subtle transition-colors duration-100 hover:bg-surface-2 hover:text-text",
        )}
      >
        <Caret size={12} weight="bold" className="shrink-0 text-faint" />
        <Folder size={14} weight="regular" className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      </button>
      {open && (
        <div role="group" className="flex flex-col gap-0.5">
          <Tree node={node} depth={depth + 1} selected={selected} onSelect={onSelect} />
        </div>
      )}
    </>
  );
}

function Tree({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: FolderNode;
  depth: number;
  selected?: string;
  onSelect: (path: string) => void;
}) {
  return (
    <>
      {node.folders.map((folder) => (
        <FolderRow
          key={folder.path}
          node={folder}
          depth={depth}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
      {node.files.map((file) => (
        <FileRow
          key={file.path}
          node={file}
          depth={depth}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

/** Collapsible directory tree built from the flat file list. */
export function FileExplorer({
  files,
  selected,
  onSelect,
}: {
  files: UiFile[];
  selected?: string;
  onSelect: (path: string) => void;
}) {
  const root = buildTree(files);
  return (
    <div role="tree" aria-label="Project files" className="flex flex-col gap-0.5 p-1.5">
      <Tree node={root} depth={0} selected={selected} onSelect={onSelect} />
    </div>
  );
}
