import { describe, expect, it } from "vitest";
import { argGhost, atToken, filterFiles, findCommand, palette } from "../src/index";

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
    expect(argGhost("/effort ")).toBe("low | high | ultra");
  });

  it("hides once an argument is typed, or for commands without args", () => {
    expect(argGhost("/effort hi")).toBeNull();
    expect(argGhost("/resume ")).toBeNull();
    expect(argGhost("/effort")).toBeNull(); // no space yet → palette territory, not ghost
  });
});

describe("@-mention tokens", () => {
  it("detects a @token ending at the cursor", () => {
    expect(atToken("see @src/a", 10)).toEqual({ start: 4, query: "src/a" });
    expect(atToken("@foo", 4)).toEqual({ start: 0, query: "foo" });
    expect(atToken("@", 1)).toEqual({ start: 0, query: "" });
  });

  it("does not trigger mid-word (e.g. an email) or after whitespace", () => {
    expect(atToken("mail a@b", 8)).toBeNull(); // '@' preceded by a non-space
    expect(atToken("no mention", 5)).toBeNull();
    expect(atToken("@a b", 4)).toBeNull(); // cursor is past the token's whitespace
  });
});

describe("filterFiles", () => {
  const files = ["src/App.tsx", "src/api.ts", "README.md", "src/components/Button.tsx"];
  it("ranks basename-prefix matches first and excludes non-matches", () => {
    const out = filterFiles(files, "ap");
    expect(out).toContain("src/App.tsx");
    expect(out).toContain("src/api.ts");
    expect(out).not.toContain("README.md");
  });
  it("returns everything (capped) for an empty query", () => {
    expect(filterFiles(files, "", 2)).toHaveLength(2);
  });
  it("matches anywhere in the path when no basename match", () => {
    expect(filterFiles(files, "components")).toEqual(["src/components/Button.tsx"]);
  });
});
