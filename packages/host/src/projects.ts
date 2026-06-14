/**
 * Per-project state isolation. blazecoder keeps ONE home dir (~/.blazecoder) for
 * user-global config (the API key in config.json), but everything that belongs to a
 * specific working directory — its sessions and the agent's cross-session memory
 * — must live under that project's own subdirectory. Isolation is therefore
 * STRUCTURAL (the directory IS the boundary), not a read-time filter that a
 * future code path could forget to apply.
 *
 * Layout:
 *   ~/.blazecoder/
 *     config.json                       # user-global config (provider + key + model)
 *     projects/
 *       <project-key>/
 *         sessions/<id>.json            # this project's conversations
 *         memory/...                    # this project's agent memory
 *
 * The stores themselves are generic (they take a root dir); the composition root
 * (buildRuntime) is the single place that decides a store's root is project-scoped.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * A storage key for a project, derived from its absolute (canonical) cwd:
 * `<readable-basename>-<8-hex-of-sha256(cwd)>`. The hash guarantees uniqueness
 * and bounded length (deep paths won't blow the 255-byte filename limit); the
 * basename keeps it human-greppable in ~/.blazecoder/projects.
 */
export function projectKey(cwd: string): string {
  const base = (cwd.split("/").filter(Boolean).pop() ?? "root").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 40) || "root";
  const hash = createHash("sha256").update(cwd).digest("hex").slice(0, 8);
  return `${base}-${hash}`;
}

/** The per-project state directory: `<home>/projects/<project-key>`. */
export function projectStateDir(home: string, cwd: string): string {
  return join(home, "projects", projectKey(cwd));
}

export interface SettingsPaths {
  user: string;
  project: string;
  local: string;
}

/**
 * Permission-settings file locations. Unlike sessions/memory (which live under
 * projectStateDir, keyed off cwd), settings live IN the working directory so they
 * travel with the repo: project settings are committable, local settings are
 * gitignored. The user scope is global under the home dir.
 */
export function settingsPaths(home: string, cwd: string): SettingsPaths {
  return {
    user: join(home, "settings.json"),
    project: join(cwd, ".blazecoder", "settings.json"),
    local: join(cwd, ".blazecoder", "settings.local.json"),
  };
}

/**
 * One-time migration. Older builds wrote ALL sessions to a single global
 * `<home>/sessions` directory, so resume leaked across projects. Relocate each
 * session into its own project dir (keyed by the session's recorded cwd). Safe
 * and idempotent: it never throws, and after it runs the legacy dir is gone, so
 * subsequent startups are instant no-ops.
 */
export async function migrateLegacySessions(home: string): Promise<void> {
  const legacyDir = join(home, "sessions");
  let files: string[];
  try {
    files = (await readdir(legacyDir)).filter((f) => f.endsWith(".json"));
  } catch {
    return; // no legacy dir → nothing to migrate
  }
  for (const f of files) {
    const src = join(legacyDir, f);
    try {
      const cwd = (JSON.parse(await readFile(src, "utf8")) as { cwd?: string }).cwd;
      if (!cwd) continue; // can't attribute it to a project → leave it in place
      const dest = join(projectStateDir(home, cwd), "sessions", f);
      await mkdir(dirname(dest), { recursive: true });
      await rename(src, dest);
    } catch {
      // Skip anything unreadable; a migration must never break startup.
    }
  }
  await rmdir(legacyDir).catch(() => {}); // remove the legacy dir if it's now empty
}
