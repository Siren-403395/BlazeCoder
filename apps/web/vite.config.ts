import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Resolve `@/` to the src root without pulling in @types/node.
const src = new URL("./src", import.meta.url).pathname;

// The web client is a thin SSE consumer; all agent work happens on the backend.
// In dev, proxy /api to the agent server so the browser stays same-origin.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": src } },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
    },
  },
});
