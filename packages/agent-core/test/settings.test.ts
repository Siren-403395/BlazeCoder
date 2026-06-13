import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyUpdate,
  HookBus,
  loadLayeredSettings,
  PermissionBroker,
  PermissionEngine,
  persistPermissionUpdate,
  readSettings,
  rulesFromSettings,
  writeSettings,
} from "../src/index";
import type { PermissionSettings, Tool } from "../src/index";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "zc-settings-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const signal = new AbortController().signal;
const tool = (name: string, readOnly: boolean): Tool => ({
  name,
  readOnly,
  description: "d",
  inputSchema: { type: "object" },
  execute: async () => ({ content: "" }),
});

describe("settings file store", () => {
  it("round-trips and ignores junk", () => {
    const dir = tmp();
    const p = join(dir, "settings.json");
    const settings: PermissionSettings = { permissions: { allow: ["Bash(git:*)"], deny: [], ask: [], defaultMode: "plan" } };
    writeSettings(p, settings);
    expect(readSettings(p)).toEqual(settings);
    expect(readSettings(join(dir, "missing.json"))).toEqual({}); // missing → empty
  });

  it("rulesFromSettings tags each rule with its source", () => {
    const rules = rulesFromSettings({ permissions: { allow: ["Bash(git:*)"], deny: ["Read(.env)"] } }, "project");
    expect(rules).toContainEqual({ source: "project", behavior: "allow", value: { toolName: "Bash", ruleContent: "git:*" } });
    expect(rules).toContainEqual({ source: "project", behavior: "deny", value: { toolName: "Read", ruleContent: ".env" } });
  });

  it("merges three scopes; defaultMode follows local > project > user", () => {
    const dir = tmp();
    const paths = { user: join(dir, "u.json"), project: join(dir, "p.json"), local: join(dir, "l.json") };
    writeSettings(paths.user, { permissions: { allow: ["Bash(ls:*)"], defaultMode: "default" } });
    writeSettings(paths.project, { permissions: { deny: ["Bash(rm:*)"], defaultMode: "acceptEdits" } });
    writeSettings(paths.local, { permissions: { ask: ["Bash(git push:*)"] } });
    const loaded = loadLayeredSettings(paths);
    expect(loaded.rules.map((r) => r.source).sort()).toEqual(["local", "project", "user"]);
    expect(loaded.defaultMode).toBe("acceptEdits"); // local has none → project wins over user
  });
});

describe("PermissionUpdate pipeline", () => {
  it("addRules dedups; removeRules drops; setMode sets defaultMode", () => {
    let s: PermissionSettings = {};
    s = applyUpdate(s, { type: "addRules", behavior: "allow", rules: ["Bash(git:*)", "Bash(git:*)"], destination: "local" });
    expect(s.permissions?.allow).toEqual(["Bash(git:*)"]);
    s = applyUpdate(s, { type: "removeRules", behavior: "allow", rules: ["Bash(git:*)"], destination: "local" });
    expect(s.permissions?.allow).toEqual([]);
    s = applyUpdate(s, { type: "setMode", mode: "plan", destination: "local" });
    expect(s.permissions?.defaultMode).toBe("plan");
  });

  it("persists to a file for local; is a no-op for session destination", () => {
    const dir = tmp();
    const p = join(dir, "settings.local.json");
    expect(persistPermissionUpdate(p, { type: "addRules", behavior: "deny", rules: ["Bash(rm:*)"], destination: "local" })).toBe(true);
    expect(JSON.parse(readFileSync(p, "utf8")).permissions.deny).toEqual(["Bash(rm:*)"]);
    expect(persistPermissionUpdate(p, { type: "addRules", behavior: "deny", rules: ["x"], destination: "session" })).toBe(false);
  });
});

describe("end-to-end: persist → reload → engine enforces the rule", () => {
  it("a persisted deny rule blocks the matching command after reload", async () => {
    const dir = tmp();
    const paths = { user: join(dir, "u.json"), project: join(dir, "p.json"), local: join(dir, "settings.local.json") };
    persistPermissionUpdate(paths.local, { type: "addRules", behavior: "deny", rules: ["Bash(rm:*)"], destination: "local" });
    const loaded = loadLayeredSettings(paths);
    expect(existsSync(paths.local)).toBe(true);

    const engine = new PermissionEngine({
      mode: "bypassPermissions", // even bypass: a deny rule still wins
      rules: loaded.rules,
      hookBus: new HookBus(),
      broker: new PermissionBroker(),
      idGen: () => "r",
    });
    const denied = await engine.check(tool("Bash", false), { command: "rm -rf /tmp/x" }, { emit: () => {}, signal });
    expect(denied.behavior).toBe("deny");
    const allowed = await engine.check(tool("Bash", false), { command: "ls -la" }, { emit: () => {}, signal });
    expect(allowed.behavior).toBe("allow"); // bypass allows the rest
  });
});
