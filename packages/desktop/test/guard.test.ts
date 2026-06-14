/**
 * The mechanical architecture invariant: the renderer is an Ink-free, node-free island.
 * It may TYPE-import @zephyrcode/core/shared/host (erased at build) but must never VALUE-
 * import @zephyrcode/host (its barrel pulls node:fs/child_process and would break Vite),
 * and must never touch @zephyrcode/cli or ink at all. This is the ~one test that keeps the
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

// import (type)? ... from "<spec>"
const IMPORT_RE = /import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/g;

describe("renderer isolation guard", () => {
  const files = walk(RENDERER);

  it("scans renderer source", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("never imports @zephyrcode/cli or ink, and only TYPE-imports @zephyrcode/host", () => {
    const violations: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const match of src.matchAll(IMPORT_RE)) {
        const isTypeOnly = Boolean(match[1]);
        const spec = match[2] ?? "";
        if (spec === "@zephyrcode/cli" || spec === "ink" || spec.startsWith("ink/")) {
          violations.push(`${file}: forbidden import of "${spec}"`);
        }
        if ((spec === "@zephyrcode/host" || spec.startsWith("@zephyrcode/host/")) && !isTypeOnly) {
          violations.push(`${file}: VALUE import of "${spec}" — the renderer may only type-import host`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
