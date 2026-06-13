import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isWorkspaceTrusted, matchesPattern, readHooks, trustWorkspace } from "../src/settings";
import { makeCommandPreToolUseHook } from "../src/adapters/commandHook";
import type { Tool } from "@coding-agent/core";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "zc-hooks-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const fakeTool = { name: "Bash" } as Tool;
const inputFor = (toolName: string, input: Record<string, unknown>) => ({ toolName, input, tool: { ...fakeTool, name: toolName } as Tool });

describe("matchesPattern", () => {
  it("handles wildcard, alternation, regex, and exact", () => {
    expect(matchesPattern("Bash", "*")).toBe(true);
    expect(matchesPattern("Bash", undefined)).toBe(true);
    expect(matchesPattern("Write", "Write|Edit")).toBe(true);
    expect(matchesPattern("Read", "Write|Edit")).toBe(false);
    expect(matchesPattern("Bash", "^Bash$")).toBe(true);
    expect(matchesPattern("Glob", "Bash")).toBe(false);
  });
});

describe("command PreToolUse hook", () => {
  it("denies on a {decision:'block'} stdout", async () => {
    const hook = makeCommandPreToolUseHook("Bash", { type: "command", command: `echo '{"decision":"block","reason":"nope"}'` });
    const d = await hook(inputFor("Bash", { command: "rm -rf /" }));
    expect(d.decision).toBe("deny");
    expect(d.decision === "deny" && d.message).toMatch(/nope/);
  });

  it("denies on exit code 2", async () => {
    const hook = makeCommandPreToolUseHook("*", { type: "command", command: `exit 2` });
    expect((await hook(inputFor("Bash", { command: "x" }))).decision).toBe("deny");
  });

  it("rewrites input via {updatedInput}", async () => {
    const hook = makeCommandPreToolUseHook("Bash", { type: "command", command: `echo '{"updatedInput":{"command":"ls -la"}}'` });
    const d = await hook(inputFor("Bash", { command: "ls" }));
    expect(d.decision).toBe("allow");
    expect(d.decision === "allow" && d.updatedInput).toEqual({ command: "ls -la" });
  });

  it("continues when the matcher does not match", async () => {
    const hook = makeCommandPreToolUseHook("Write", { type: "command", command: `exit 2` });
    expect((await hook(inputFor("Bash", { command: "x" }))).decision).toBe("continue");
  });
});

describe("workspace trust gate + settings reading", () => {
  it("isWorkspaceTrusted flips after trustWorkspace", () => {
    const d = tmp();
    expect(isWorkspaceTrusted(d)).toBe(false);
    trustWorkspace(d);
    expect(isWorkspaceTrusted(d)).toBe(true);
  });

  it("readHooks parses a PreToolUse command matcher and ignores junk", () => {
    const d = tmp();
    const path = join(d, "settings.json");
    const { writeFileSync } = require("node:fs");
    writeFileSync(
      path,
      JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "true" }] }, { bogus: 1 }] } }),
    );
    const h = readHooks(path);
    expect(h.PreToolUse).toHaveLength(1);
    expect(h.PreToolUse![0]!.hooks[0]!.command).toBe("true");
  });
});
