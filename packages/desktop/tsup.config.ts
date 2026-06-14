import { defineConfig } from "tsup";

/**
 * Bundle the Electron MAIN process and the PRELOAD script (and the workspace packages
 * they import as TS source — @blazecoder/host/core/shared) into self-contained CJS.
 * Electron loads CJS for main/preload; the renderer is built separately by Vite.
 *
 * Explicit entry NAMES (`main`, `preload`) keep the artifact paths stable and
 * self-documenting — dist/main/main.cjs + dist/main/preload.cjs — instead of relying on
 * tsup mirroring the src/main + src/preload tree (which produced a fragile
 * dist/main/main/main.cjs). package.json "main" and main.ts's preload resolution both
 * point at these names; postbuild.cjs asserts both artifacts exist.
 */
export default defineConfig({
  entry: {
    main: "src/main/main.ts",
    preload: "src/preload/preload.ts",
  },
  outDir: "dist/main",
  format: ["cjs"],
  platform: "node",
  target: "node20",
  external: ["electron"],
  // Bundle the workspace packages (they ship as TS source, not built artifacts).
  noExternal: [/^@blazecoder\//],
  sourcemap: true,
  clean: true,
  dts: false,
  outExtension: () => ({ js: ".cjs" }),
  onSuccess: "node scripts/postbuild.cjs",
});
