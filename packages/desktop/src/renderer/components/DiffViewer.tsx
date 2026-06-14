import type { FileDiff } from "@blazecoder/shared";
import { shortPath } from "../app/format";

/** A git-style structured diff (no before/after content — only the computed line diff). */
export function DiffViewer({ diff, path }: { diff: FileDiff; path?: string }) {
  return (
    <div className="diff">
      <div className="diff__head">
        <span className="diff__path" title={path}>
          {shortPath(path)}
        </span>
        <span className="diff__stat">
          <span className="add">+{diff.added}</span>
          <span className="del">-{diff.removed}</span>
        </span>
      </div>
      <div className="diff__body">
        {diff.hunks.map((hunk, hi) => (
          <div className="diff__hunk" key={hi}>
            {hunk.lines.map((line, li) => (
              <div className={`diff__line diff__line--${line.kind}`} key={`${hi}-${li}`}>
                <span className="diff__gutter">{line.oldLine ?? ""}</span>
                <span className="diff__gutter">{line.newLine ?? ""}</span>
                <span className="diff__mark">{line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}</span>
                <span className="diff__text">{line.text === "" ? " " : line.text}</span>
              </div>
            ))}
          </div>
        ))}
        {diff.truncated ? <div className="diff__truncated">Diff truncated for display.</div> : null}
      </div>
    </div>
  );
}
