/**
 * Launch the Electron desktop GUI as a first-class `blazecoder` subcommand: `blazecoder --gui`.
 *
 * This runs the BUILT app (Electron loadFile of the prod renderer) — fast, no dev server —
 * so it fits the installed-CLI model exactly like `--setup`/`--print`. `pnpm desktop` stays
 * the developer command (Vite HMR). The GUI shares the same ~/.blazecoder/config.json, so the
 * model you connect once with `blazecoder --setup` is the one the GUI uses; no separate setup.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The repo root. The launcher exports BLAZECODER_REPO; otherwise derive it from this module's
 *  location — bundled at packages/cli/dist/blazecoder.js (or run from src via tsx), both three
 *  levels under the repo. */
function repoRoot(): string {
  if (process.env.BLAZECODER_REPO) return process.env.BLAZECODER_REPO;
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

function spawnInherit(cmd: string, cmdArgs: string[], cwd: string, env = process.env): Promise<number> {
  return new Promise((res) => {
    const child = spawn(cmd, cmdArgs, { cwd, env, stdio: "inherit" });
    child.on("exit", (code) => res(code ?? 0));
    child.on("error", (err) => {
      process.stderr.write(`Failed to run ${cmd}: ${err.message}\n`);
      res(1);
    });
  });
}

export async function launchDesktop(): Promise<number> {
  const repo = repoRoot();
  const desktopDir = join(repo, "packages", "desktop");
  if (!existsSync(join(desktopDir, "package.json"))) {
    process.stderr.write(`Desktop package not found at ${desktopDir}.\nRe-run ./install.sh from the blazecoder repo.\n`);
    return 1;
  }

  // Build the prod artifacts on demand (first run, or after a fresh pull cleaned dist/).
  const mainArtifact = join(desktopDir, "dist", "main", "main.cjs");
  const rendererArtifact = join(desktopDir, "dist", "renderer", "index.html");
  if (!existsSync(mainArtifact) || !existsSync(rendererArtifact)) {
    process.stderr.write("Building the desktop GUI (first run)…\n");
    const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const built = await spawnInherit(pnpm, ["--filter", "@blazecoder/desktop", "build"], repo);
    if (built !== 0 || !existsSync(mainArtifact) || !existsSync(rendererArtifact)) {
      process.stderr.write("Could not build the desktop GUI. Run `pnpm --filter @blazecoder/desktop build` to see the error.\n");
      return built || 1;
    }
  }

  // Resolve the Electron binary from the desktop package's own dependency.
  let electronBin: string;
  try {
    electronBin = createRequire(join(desktopDir, "package.json"))("electron") as string;
  } catch {
    process.stderr.write("Electron is not installed. Run ./install.sh (or `pnpm install`) to fetch it, then retry.\n");
    return 1;
  }

  // PROD launch: no dev-server env (main.ts then loadFile's the built renderer); clear the
  // node-mode flag so the binary boots as the GUI shell, not a plain node interpreter.
  const env = { ...process.env };
  delete env.BLAZECODER_DESKTOP_DEV_SERVER;
  delete env.ELECTRON_RUN_AS_NODE;
  return spawnInherit(electronBin, ["."], desktopDir, env);
}
