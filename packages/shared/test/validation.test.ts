import { describe, expect, it } from "vitest";
import { inferLanguage, isSecretPath, isUnsafeRelativePath, looksLikeSecret } from "../src/index";

describe("isUnsafeRelativePath", () => {
  it("flags traversal and encoded traversal", () => {
    expect(isUnsafeRelativePath("/src/../etc/passwd")).toBe(true);
    expect(isUnsafeRelativePath("/a/%2e%2e/b")).toBe(true);
    expect(isUnsafeRelativePath("/src/App.tsx")).toBe(false);
  });
});

describe("isSecretPath", () => {
  it("flags secret/credential files", () => {
    expect(isSecretPath("/proj/.env")).toBe(true);
    expect(isSecretPath("/proj/.env.local")).toBe(true);
    expect(isSecretPath("/proj/server.pem")).toBe(true);
    expect(isSecretPath("/home/me/.ssh/id_ed25519")).toBe(true);
    expect(isSecretPath("/home/me/.aws/credentials")).toBe(true);
    expect(isSecretPath("/proj/src/App.tsx")).toBe(false);
    expect(isSecretPath("/proj/README.md")).toBe(false);
  });
});

describe("looksLikeSecret", () => {
  it("detects embedded API/private keys", () => {
    expect(looksLikeSecret('const k = "sk-abcdefghijklmnopqrstuvwxyz0123"')).toBe(true);
    expect(looksLikeSecret("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
    expect(looksLikeSecret('const greeting = "hello world"')).toBe(false);
  });
});

describe("inferLanguage", () => {
  it("maps extensions", () => {
    expect(inferLanguage("/a.tsx")).toBe("tsx");
    expect(inferLanguage("/a.css")).toBe("css");
    expect(inferLanguage("/a.py")).toBe("py");
    expect(inferLanguage("/a.rs")).toBe("rs");
    expect(inferLanguage("/a.unknown")).toBe("txt");
  });
});
