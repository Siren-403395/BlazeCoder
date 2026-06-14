import { describe, expect, it } from "vitest";
import {
  isEffort,
  isPersistScope,
  validateCwd,
  validateOptionalSessionId,
  validatePermissionDecision,
  validateRunRequest,
  validateSessionId,
  validateUrl,
} from "../src/main/validate";

describe("validate — structural IPC payload validation", () => {
  it("isEffort accepts the three efforts only", () => {
    expect(["low", "high", "ultra"].every(isEffort)).toBe(true);
    expect(isEffort("medium")).toBe(false);
    expect(isEffort(5)).toBe(false);
    expect(isEffort(undefined)).toBe(false);
  });

  it("isPersistScope clamps to the 4 UI scopes (in-memory cliArg is not selectable)", () => {
    expect(["session", "local", "project", "user"].every(isPersistScope)).toBe(true);
    expect(isPersistScope("cliArg")).toBe(false);
    expect(isPersistScope("nope")).toBe(false);
  });

  it("validateRunRequest requires a non-empty prompt and validates optional fields", () => {
    expect(() => validateRunRequest({ prompt: "  " })).toThrow();
    expect(() => validateRunRequest({})).toThrow();
    expect(() => validateRunRequest(null)).toThrow();
    expect(validateRunRequest({ prompt: "hi" })).toEqual({ prompt: "hi" });
    expect(validateRunRequest({ prompt: "hi", effort: "ultra", sessionId: "s1" })).toEqual({
      prompt: "hi",
      effort: "ultra",
      sessionId: "s1",
    });
    expect(() => validateRunRequest({ prompt: "hi", effort: "turbo" })).toThrow();
    expect(() => validateRunRequest({ prompt: "hi", sessionId: "" })).toThrow();
  });

  it("validatePermissionDecision validates behavior and clamps persist", () => {
    expect(validatePermissionDecision({ requestId: "r1", behavior: "deny" })).toEqual({ requestId: "r1", behavior: "deny" });
    expect(validatePermissionDecision({ requestId: "r1", behavior: "allow", persist: "project" })).toEqual({
      requestId: "r1",
      behavior: "allow",
      persist: "project",
    });
    expect(() => validatePermissionDecision({ requestId: "r1", behavior: "maybe" })).toThrow();
    expect(() => validatePermissionDecision({ requestId: "", behavior: "allow" })).toThrow();
    expect(() => validatePermissionDecision({ requestId: "r1", behavior: "allow", persist: "cliArg" })).toThrow();
  });

  it("validateCwd / validateSessionId / validateUrl reject empties; optional session id passes undefined", () => {
    expect(() => validateCwd("")).toThrow();
    expect(validateCwd("/x")).toBe("/x");
    expect(() => validateSessionId("  ")).toThrow();
    expect(validateOptionalSessionId(undefined)).toBeUndefined();
    expect(validateOptionalSessionId("s1")).toBe("s1");
    expect(() => validateUrl("")).toThrow();
    expect(validateUrl("https://x")).toBe("https://x");
  });
});
