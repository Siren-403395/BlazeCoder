import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Renderer build. root = src/renderer; base "./" so the prod bundle loads from
 * file:// inside the packaged app. Dev server is pinned to 127.0.0.1 (never 0.0.0.0)
 * so the renderer is not exposed on the network.
 */
export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, "src/renderer"),
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
  },
});
