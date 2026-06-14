import { useState } from "react";
import { FolderOpen, FolderGit2, CornerDownLeft } from "lucide-react";

/** The empty state: no project attached yet. Calm, centered, one clear action. */
export function ProjectPicker({
  onOpenDialog,
  onOpenPath,
}: {
  onOpenDialog: () => void;
  onOpenPath: (cwd: string) => void;
}) {
  const [path, setPath] = useState("");
  return (
    <div className="picker">
      <div className="picker__card">
        <div className="picker__mark" aria-hidden>
          <FolderGit2 size={26} strokeWidth={1.5} />
        </div>
        <h1 className="picker__title">Open a workspace</h1>
        <p className="picker__sub">
          Point blazecoder at a project directory. It runs the same agent the terminal does, with visible tools,
          diffs, and approvals.
        </p>
        <div className="picker__row">
          <input
            className="picker__input"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && path.trim()) onOpenPath(path.trim());
            }}
            placeholder="/path/to/your/project"
            spellCheck={false}
          />
          <button className="btn btn--ghost" onClick={() => path.trim() && onOpenPath(path.trim())} disabled={!path.trim()}>
            <CornerDownLeft size={16} strokeWidth={1.75} />
            Attach
          </button>
        </div>
        <button className="btn btn--primary picker__browse" onClick={onOpenDialog}>
          <FolderOpen size={16} strokeWidth={1.75} />
          Browse for a folder
        </button>
      </div>
    </div>
  );
}
