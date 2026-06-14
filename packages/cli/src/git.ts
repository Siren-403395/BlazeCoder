/**
 * Read-only git helpers for the TUI's `/changes` command.
 *
 * The agent applies file edits without a built-in undo by design: this workspace is a git repo and
 * the user commits constantly, so git is the rollback substrate — and unlike any in-app Write/Edit
 * snapshot, it also captures Bash side effects (sed -i, formatters, rm, installs), deletes, and
 * renames. `/changes` surfaces that full footprint; `git restore -p` / `git checkout -p` discard it.
 * We deliberately do NOT reimplement a partial, lying undo on top of the diff (see the rollback
 * decision). Everything here is read-only: status + diffstat, never a mutation.
 */

import { execFile } from "node:child_process";

function git(cwd: string, args: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    execFile("git", ["-C", cwd, ...args], { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      const code = err && typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : err ? 1 : 0;
      resolve({ stdout: stdout ?? "", code });
    });
  });
}

export interface GitChanges {
  /** False when cwd isn't a git work tree (the message explains the fallback). */
  ok: boolean;
  message: string;
}

/**
 * Compose a compact, human-readable view of the working-tree changes: porcelain status (one line
 * per changed/untracked path) + a `--stat` summary, plus a pointer to the full diff / selective
 * discard. Returns ok:false with an honest note when cwd is not a git repo.
 */
export async function gitChanges(cwd: string): Promise<GitChanges> {
  const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0 || inside.stdout.trim() !== "true") {
    return {
      ok: false,
      message:
        "Not a git repository — /changes lists the agent's file changes via git. Review edits in your editor instead.",
    };
  }
  const [status, stat] = await Promise.all([
    git(cwd, ["status", "--short"]),
    git(cwd, ["diff", "--stat"]),
  ]);
  const dirty = status.stdout.trimEnd();
  if (!dirty) {
    return { ok: true, message: "No file changes this session — the working tree is clean." };
  }
  const parts = [
    "Changes in the working tree (git):",
    "",
    dirty,
  ];
  const statBody = stat.stdout.trimEnd();
  if (statBody) parts.push("", statBody);
  parts.push("", "Run `git diff` for the full diff · `git restore -p` / `git checkout -p` to discard selectively.");
  return { ok: true, message: parts.join("\n") };
}
