import { defineConfig } from "vitest/config";

/**
 * Test config is SEPARATE from vite.config.ts (whose root is src/renderer for the browser
 * build). The unit suites are headless node tests for the PURE modules — reducer, transcript,
 * validate — and the renderer-isolation guard. No DOM, no Electron, no React plugin.
 */
export default defineConfig({
  test: {
    root: __dirname,
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
