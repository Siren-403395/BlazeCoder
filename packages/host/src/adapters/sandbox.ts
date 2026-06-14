/**
 * LocalProcessSandbox — runs the agent's Bash commands as real child processes in
 * the working directory. Safety in V1 comes from the permission layer (every Bash
 * command is approval-gated by default); this adapter adds the operational
 * guards: a wall-clock timeout, a process-GROUP kill (so child processes a command
 * spawns are also reaped), AbortSignal cancellation, and an output cap so a noisy
 * command cannot blow up the transcript. An OS-level sandbox (macOS sandbox-exec /
 * Linux bwrap) can wrap this later behind the same Sandbox port.
 */

import { spawn } from "node:child_process";
import type { Sandbox, SandboxResult } from "@blazecoder/core";

const MAX_STREAM_CHARS = 30_000;
const SIGKILL_GRACE_MS = 3_000;

const TRUNC_MARK = "\n…[output truncated]";

function capped(buf: string, chunk: string): string {
  // Once truncated the buffer overshoots MAX by the marker, so `> MAX` catches it
  // while still letting a buffer that landed exactly on MAX accept one more chunk.
  if (buf.length > MAX_STREAM_CHARS) return buf;
  const next = buf + chunk;
  return next.length > MAX_STREAM_CHARS ? next.slice(0, MAX_STREAM_CHARS) + TRUNC_MARK : next;
}

export interface LocalProcessSandboxOptions {
  /** Shell used to interpret the command (default /bin/sh, or cmd.exe on Windows). */
  shell?: string;
}

export class LocalProcessSandbox implements Sandbox {
  readonly available = true;
  private readonly shell: string;

  constructor(opts: LocalProcessSandboxOptions = {}) {
    this.shell = opts.shell ?? (process.platform === "win32" ? "cmd.exe" : "/bin/sh");
  }

  run(
    command: string,
    opts: { cwd?: string; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<SandboxResult> {
    const timeoutMs = opts.timeoutMs ?? 120_000;
    return new Promise<SandboxResult>((resolve) => {
      const args = process.platform === "win32" ? ["/c", command] : ["-c", command];
      const child = spawn(this.shell, args, {
        cwd: opts.cwd,
        detached: process.platform !== "win32", // own process group so we can kill the whole tree
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      const killGroup = (sig: NodeJS.Signals) => {
        try {
          if (child.pid !== undefined && process.platform !== "win32") process.kill(-child.pid, sig);
          else child.kill(sig);
        } catch {
          try {
            child.kill(sig);
          } catch {
            /* already gone */
          }
        }
      };

      const timer = setTimeout(() => {
        timedOut = true;
        killGroup("SIGTERM");
        setTimeout(() => killGroup("SIGKILL"), SIGKILL_GRACE_MS);
      }, timeoutMs);

      const onAbort = () => killGroup("SIGTERM");
      opts.signal?.addEventListener("abort", onAbort, { once: true });

      const finish = (exitCode: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        resolve({ stdout, stderr, exitCode, timedOut });
      };

      child.stdout?.on("data", (d: Buffer) => {
        stdout = capped(stdout, d.toString());
      });
      child.stderr?.on("data", (d: Buffer) => {
        stderr = capped(stderr, d.toString());
      });
      child.on("error", (err) => {
        stderr = capped(stderr, `failed to start command: ${err.message}`);
        finish(127);
      });
      child.on("close", (code) => finish(code ?? (timedOut ? 124 : 1)));
    });
  }
}
