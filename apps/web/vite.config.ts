import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The web client is a thin SSE consumer; all agent work happens on the backend.
// In dev, proxy /api to the agent server so the browser stays same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
    },
  },
});
