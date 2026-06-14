// Dev launcher: spawn the Electron binary against this package, pointing it at the
// Vite dev server. Forwards exit/signal so Ctrl-C in `pnpm dev` tears everything down.
const { spawn } = require("node:child_process");
const { resolve } = require("node:path");
const electron = require("electron");

const packageDir = resolve(__dirname, "..");
const env = {
  ...process.env,
  ZEPHYRCODE_DESKTOP_DEV_SERVER: "http://127.0.0.1:5173",
};
// Electron sets this when re-spawning itself as a node process; clearing it makes the
// binary boot as the GUI shell instead of a plain node interpreter.
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ["."], { cwd: packageDir, env, stdio: "inherit" });

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
