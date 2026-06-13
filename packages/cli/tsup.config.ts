import { defineConfig } from "tsup";

/**
 * Bundle the CLI (and the workspace packages it imports as TS source) into one
 * self-contained ESM file with a node shebang. Runtime npm deps (ink, react, …)
 * stay external and are resolved from node_modules — they are declared in
 * package.json dependencies, the standard npm-package shape.
 */
export default defineConfig({
  entry: { zephyrcode: "src/main.tsx" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  // Bundle the workspace packages (they ship as TS source, not built artifacts).
  noExternal: [/^@coding-agent\//],
  clean: true,
  shims: false,
  dts: false,
});
