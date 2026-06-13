import { describe, expect, it } from "vitest";
import { LocalProcessSandbox } from "../src/index";

const onPosix = process.platform !== "win32";

describe.skipIf(!onPosix)("LocalProcessSandbox", () => {
  it("captures stdout and a zero exit code", async () => {
    const sb = new LocalProcessSandbox();
    const res = await sb.run("echo hello-world", {});
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("hello-world");
    expect(res.timedOut).toBe(false);
  });

  it("propagates a non-zero exit code and stderr", async () => {
    const sb = new LocalProcessSandbox();
    const res = await sb.run("echo oops 1>&2; exit 3", {});
    expect(res.exitCode).toBe(3);
    expect(res.stderr).toContain("oops");
  });

  it("runs in the given cwd", async () => {
    const sb = new LocalProcessSandbox();
    const res = await sb.run("pwd", { cwd: "/tmp" });
    expect(res.stdout.trim()).toMatch(/\/tmp$/);
  });

  it("times out a long-running command and reports timedOut", async () => {
    const sb = new LocalProcessSandbox();
    const res = await sb.run("sleep 5", { timeoutMs: 100 });
    expect(res.timedOut).toBe(true);
    expect(res.exitCode).not.toBe(0);
  });

  it("is cancellable via an AbortSignal", async () => {
    const sb = new LocalProcessSandbox();
    const ac = new AbortController();
    const p = sb.run("sleep 5", { signal: ac.signal });
    setTimeout(() => ac.abort(), 50);
    const res = await p;
    expect(res.exitCode).not.toBe(0);
  });

  it("caps very large output", async () => {
    const sb = new LocalProcessSandbox();
    // Print ~200k chars; the sandbox should cap and mark truncation.
    const res = await sb.run("for i in $(seq 1 4000); do echo 0123456789012345678901234567890123456789012345678; done", {});
    expect(res.stdout.length).toBeLessThan(35_000);
    expect(res.stdout).toContain("truncated");
  });
});
