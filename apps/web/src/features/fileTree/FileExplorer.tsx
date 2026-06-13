import type { UiFile } from "../../lib/agentState";

export function FileExplorer({
  files,
  selected,
  onSelect,
}: {
  files: UiFile[];
  selected?: string;
  onSelect: (path: string) => void;
}) {
  if (files.length === 0) {
    return <div className="pane-empty small">No files yet.</div>;
  }
  return (
    <ul className="file-list">
      {files.map((f) => (
        <li
          key={f.path}
          className={f.path === selected ? "file-item selected" : "file-item"}
          onClick={() => onSelect(f.path)}
        >
          {f.path}
        </li>
      ))}
    </ul>
  );
}

export function CodeView({ file }: { file?: UiFile }) {
  if (!file) return <div className="pane-empty small">Select a file to view its code.</div>;
  return (
    <pre className="code-view">
      <code>{file.content}</code>
    </pre>
  );
}
