// Fail the build loudly if the Electron entrypoints did not land where package.json
// "main" and main.ts's preload resolution expect them. A tsup entry rename would
// otherwise break the app only at launch, never at build/typecheck/test time.
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const required = ["dist/main/main.cjs", "dist/main/preload.cjs"];
const missing = required.filter((p) => !existsSync(resolve(__dirname, "..", p)));

if (missing.length) {
  console.error(`\n[postbuild] missing Electron artifact(s): ${missing.join(", ")}`);
  console.error("[postbuild] the tsup entry names must stay 'main' and 'preload'.\n");
  process.exit(1);
}
console.log("[postbuild] Electron main + preload artifacts present.");
