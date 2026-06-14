/**
 * The mechanical architecture invariant: the renderer is an Ink-free, node-free island.
 * It may TYPE-import @blazecoder/core/shared/host (erased at build) but must never VALUE-
 * import @blazecoder/host (its barrel pulls node:fs/child_process and would break Vite),
 * and must never touch @blazecoder/cli or ink at all. This is the ~one test that keeps the
 * sibling-adapter boundary from eroding.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const RENDERER = join(here, "../src/renderer");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

// Match EVERY module-reference form so the guard can't be sidestepped:
//   import (type)? ... from "x"   |   export (type)? ... from "x"   (re-exports DO run side effects)
//   import "x" (bare)             |   import("x") / require("x") (dynamic)
const FROM_RE = /\b(import|export)\s+(type\s+)?[^;{]*?\bfrom\s+["']([^"']+)["']/g;
const BARE_IMPORT_RE = /\bimport\s+["']([^"']+)["']/g;
const DYNAMIC_RE = /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g;

const forbidden = (spec: string) => spec === "@blazecoder/cli" || spec === "ink" || spec.startsWith("ink/");
const isHost = (spec: string) => spec === "@blazecoder/host" || spec.startsWith("@blazecoder/host/");

describe("renderer isolation guard", () => {
  const files = walk(RENDERER);

  it("scans renderer source", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("never reaches @blazecoder/cli or ink, and only TYPE-imports @blazecoder/host (no value/re-export/dynamic)", () => {
    const violations: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");

      for (const m of src.matchAll(FROM_RE)) {
        const isTypeOnly = Boolean(m[2]);
        const spec = m[3] ?? "";
        if (forbidden(spec)) violations.push(`${file}: forbidden ${m[1]} of "${spec}"`);
        // A `export ... from "host"` re-export executes the module (side effects) even with the
        // `type` keyword stripped at build, so a value re-export of host is forbidden too.
        if (isHost(spec) && !(m[1] === "import" && isTypeOnly)) {
          violations.push(`${file}: non-type ${m[1]} of "${spec}" — the renderer may only type-import host`);
        }
      }
      for (const m of src.matchAll(BARE_IMPORT_RE)) {
        const spec = m[1] ?? "";
        if (forbidden(spec) || isHost(spec)) violations.push(`${file}: bare side-effect import of "${spec}"`);
      }
      for (const m of src.matchAll(DYNAMIC_RE)) {
        const spec = m[1] ?? "";
        if (forbidden(spec) || isHost(spec)) violations.push(`${file}: dynamic import/require of "${spec}"`);
      }
    }
    expect(violations).toEqual([]);
  });
});
