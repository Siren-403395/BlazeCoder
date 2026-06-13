import { describe, expect, it } from "vitest";
import {
  inferLanguage,
  isUnsafeRelativePath,
  validateProject,
  validateProjectFile,
  REQUIRED_FILES,
} from "../src/index";

describe("isUnsafeRelativePath", () => {
  it("flags traversal and encoded traversal", () => {
    expect(isUnsafeRelativePath("/src/../etc/passwd")).toBe(true);
    expect(isUnsafeRelativePath("/a/%2e%2e/b")).toBe(true);
    expect(isUnsafeRelativePath("/src/App.tsx")).toBe(false);
  });
});

describe("validateProjectFile", () => {
  it("accepts a normal file", () => {
    expect(validateProjectFile({ path: "/src/App.tsx", content: "export default 1" }).ok).toBe(true);
  });
  it("rejects non-absolute paths", () => {
    expect(validateProjectFile({ path: "src/App.tsx", content: "x" }).ok).toBe(false);
  });
  it("rejects .env files", () => {
    expect(validateProjectFile({ path: "/.env", content: "x" }).ok).toBe(false);
  });
  it("rejects empty content", () => {
    expect(validateProjectFile({ path: "/a.ts", content: "   " }).ok).toBe(false);
  });
  it("detects secrets", () => {
    const res = validateProjectFile({ path: "/a.ts", content: 'const k = "sk-abcdefghijklmnopqrstuvwx"' });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/secret/i);
  });
});

describe("validateProject", () => {
  it("requires the standard React+Vite files", () => {
    const res = validateProject([{ path: "/src/App.tsx", language: "tsx", content: "export default () => null" }]);
    expect(res.ok).toBe(false);
    for (const required of REQUIRED_FILES) {
      if (required !== "/src/App.tsx") {
        expect(res.errors.some((e) => e.includes(required))).toBe(true);
      }
    }
  });
});

describe("inferLanguage", () => {
  it("maps extensions", () => {
    expect(inferLanguage("/a.tsx")).toBe("tsx");
    expect(inferLanguage("/a.css")).toBe("css");
    expect(inferLanguage("/a.unknown")).toBe("txt");
  });
});
