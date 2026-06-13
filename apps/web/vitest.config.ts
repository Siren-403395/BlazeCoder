import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Tests resolve `@/` the same way the app does; no Tailwind plugin here so CSS
// imports stay inert under jsdom.
const src = new URL("./src", import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": src } },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    css: false,
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
