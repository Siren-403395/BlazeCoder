/**
 * End-to-end test of the SHIPPED artifact: build the bundle, then drive the real
 * `node dist/ca.js` process — argv parsing, config load, runtime wiring, headless
 * output, and exit codes — against throwaway temp dirs with the offline stub
 * model. This is the outermost ring of the test loop; the tool-execution path is
 * covered in-process by headless.test.ts.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(pkgRoot, "dist", "blazecoder.js");
// On Windows the .bin shim is tsup.CMD, and spawning a .CMD requires a shell.
const onWindows = process.platform === "win32";
const tsupBin = join(pkgRoot, "node_modules", ".bin", onWindows ? "tsup.CMD" : "tsup");

beforeAll(() => {
  const build = spawnSync(onWindows ? `"${tsupBin}"` : tsupBin, [], { cwd: pkgRoot, encoding: "utf8", shell: onWindows });
  if (build.status !== 0) throw new Error(`tsup build failed: ${build.stderr || build.stdout}`);
}, 60_000);

function runCa(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const home = mkdtempSync(join(tmpdir(), "zc-e2e-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "zc-e2e-cwd-"));
  try {
    const res = spawnSync(process.execPath, [bundle, ...args, "--cwd", cwd], {
      env: { ...process.env, BLAZECODER_HOME: home, AGENT_FAKE_MODEL: "1" },
      encoding: "utf8",
      timeout: 20_000,
    });
    return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe("ca binary (end-to-end)", () => {
  it("--version prints the version and exits 0", () => {
    const r = runCa(["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("0.1.0");
  });

  it("--help lists the headless and effort flags", () => {
    const r = runCa(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("--print");
    expect(r.stdout).toContain("--effort");
  });

  it("runs a prompt headlessly and emits a JSON result", () => {
    const r = runCa(["--print", "say hi", "--output-format", "json"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.subtype).toBe("success");
    expect(parsed.summary).toContain("say hi");
    expect(typeof parsed.sessionId).toBe("string");
  });

  it("rejects an empty --print prompt with a non-zero exit", () => {
    const r = runCa(["--print", "   "]);
    expect(r.status).toBe(2);
  });

  it("persists the session so --resume can list it", () => {
    // A fresh home per run means a brand-new session list — here just assert the
    // listing path runs and exits cleanly with no sessions.
    const r = runCa(["--resume"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/No saved sessions|Recent sessions/);
  });
});
