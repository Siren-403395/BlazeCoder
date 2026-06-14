import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentRuntime,
  FixedClock,
  getSuggestions,
  InMemoryMemoryStore,
  InMemorySessionStore,
  InMemoryWorkspace,
  loadLayeredSettings,
  silentLogger,
} from "../src/index";
import { reply, ScriptedGateway, call } from "./fakes";
import type { AgentEvent } from "@blazecoder/shared";

describe("getSuggestions", () => {
  it("suggests a reusable 2-word prefix for an ordinary command", () => {
    expect(getSuggestions("Bash", { command: "git commit -m x" })).toEqual(["Bash(git commit:*)"]);
  });

  it("suggests an EXACT rule (not a prefix) for a bare interpreter/shell", () => {
    expect(getSuggestions("Bash", { command: "sudo rm -rf /x" })).toEqual(["Bash(sudo rm -rf /x)"]);
    expect(getSuggestions("Bash", { command: "python train.py" })).toEqual(["Bash(python train.py)"]);
  });

  it("suggests a directory glob for file tools", () => {
    expect(getSuggestions("Edit", { file_path: "/a/b/c.ts" })).toEqual(["Edit(/a/b/**)"]);
  });
});

describe("ask flow attaches suggestions and persists an always-allow", () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "zc-sugg-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("emits suggestions on the ask, then persistPermission writes the rule and auto-allows next time", async () => {
    const dir = tmp();
    const files = { user: join(dir, "u.json"), project: join(dir, "p.json"), local: join(dir, "settings.local.json") };
    const clock = new FixedClock(1);
    const rt = createAgentRuntime({
      gateway: new ScriptedGateway("m", [reply("", [call("b", "Bash", { command: "git status" })]), reply("done", [])]),
      sessionStore: new InMemorySessionStore(clock),
      memory: new InMemoryMemoryStore(),
      workspace: new InMemoryWorkspace(),
      sandbox: { available: true, async run() { return { stdout: "", stderr: "", exitCode: 0, timedOut: false }; } },
      clock,
      logger: silentLogger,
      permissionMode: "default", // Bash is not auto-allowed → asks
      settingsFiles: files,
    });

    const events: AgentEvent[] = [];
    const emit = (e: AgentEvent) => {
      events.push(e);
      if (e.type === "permission_request") {
        // simulate the user pressing [a] (always, local).
        rt.persistPermission({ type: "addRules", behavior: "allow", rules: e.suggestions ?? [], destination: "local" });
        rt.resolvePermission(e.requestId, { behavior: "allow" });
      }
    };
    await rt.run({ prompt: "check status" }, emit, new AbortController().signal);

    const ask = events.find((e): e is Extract<AgentEvent, { type: "permission_request" }> => e.type === "permission_request");
    expect(ask?.suggestions).toEqual(["Bash(git status:*)"]);
    // The rule was written to the local settings file.
    expect(JSON.parse(readFileSync(files.local, "utf8")).permissions.allow).toEqual(["Bash(git status:*)"]);
    // And reloading those settings yields the rule (round-trip).
    expect(loadLayeredSettings(files).rules.some((r) => r.value.ruleContent === "git status:*")).toBe(true);
  });
});
