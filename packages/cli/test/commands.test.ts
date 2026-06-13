import { describe, expect, it } from "vitest";
import { argGhost, findCommand, palette } from "../src/index";

describe("slash-command palette", () => {
  it("opens for a bare slash and lists every command", () => {
    const p = palette("/");
    expect(p.open).toBe(true);
    expect(p.matches.map((c) => c.name)).toContain("resume");
    expect(p.matches.map((c) => c.name)).toContain("effort");
  });

  it("prefix-filters by the typed name (and aliases)", () => {
    // "res" matches resume (name) and clear (via its alias "reset").
    expect(palette("/resu").matches.map((c) => c.name)).toEqual(["resume"]);
    const e = palette("/e").matches.map((c) => c.name);
    expect(e).toContain("effort");
    expect(e).toContain("exit");
    expect(e).not.toContain("resume");
  });

  it("closes once a space (the name is committed) or non-slash text is typed", () => {
    expect(palette("/effort ").open).toBe(false);
    expect(palette("hello").open).toBe(false);
  });

  it("matches on aliases too", () => {
    expect(palette("/reset").matches.map((c) => c.name)).toEqual(["clear"]);
  });
});

describe("findCommand", () => {
  it("resolves names and aliases", () => {
    expect(findCommand("effort")?.name).toBe("effort");
    expect(findCommand("reset")?.name).toBe("clear");
    expect(findCommand("nope")).toBeUndefined();
  });
});

describe("argGhost (placeholder)", () => {
  it("shows the choices after `/cmd ` while the arg is empty", () => {
    expect(argGhost("/effort ")).toBe("low | medium | high | ultra");
    expect(argGhost("/reasoning ")).toBe("hidden | summary | full");
  });

  it("hides once an argument is typed, or for commands without args", () => {
    expect(argGhost("/effort hi")).toBeNull();
    expect(argGhost("/resume ")).toBeNull();
    expect(argGhost("/effort")).toBeNull(); // no space yet → palette territory, not ghost
  });
});
