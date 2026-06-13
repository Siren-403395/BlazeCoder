import { describe, expect, it } from "vitest";
import { toolMeta } from "@/lib/toolMeta";

describe("toolMeta", () => {
  it("maps known tools to label / icon / salient argument", () => {
    expect(toolMeta("write_file", { path: "/src/App.tsx" })).toEqual({
      label: "Write",
      icon: "write",
      detail: "/src/App.tsx",
      openable: true,
    });
    expect(toolMeta("run_command", { command: "npm test" })).toMatchObject({
      label: "Run",
      icon: "shell",
      detail: "npm test",
    });
    expect(toolMeta("build_preview", {})).toMatchObject({ label: "Preview", icon: "preview", detail: "" });
  });

  it("falls back gracefully for unknown tools", () => {
    expect(toolMeta("frobnicate", { whatever: "value" })).toEqual({
      label: "frobnicate",
      icon: "tool",
      detail: "value",
      openable: false,
    });
  });
});
