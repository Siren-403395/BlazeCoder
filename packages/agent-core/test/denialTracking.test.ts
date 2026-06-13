import { describe, expect, it } from "vitest";
import { DenialTracker } from "../src/index";

describe("DenialTracker", () => {
  it("trips after 3 consecutive denials", () => {
    const t = new DenialTracker();
    t.recordDenial();
    t.recordDenial();
    expect(t.shouldFallbackToPrompting()).toBe(false);
    t.recordDenial();
    expect(t.shouldFallbackToPrompting()).toBe(true);
  });

  it("a success resets the consecutive streak", () => {
    const t = new DenialTracker();
    t.recordDenial();
    t.recordDenial();
    t.recordSuccess();
    t.recordDenial();
    expect(t.shouldFallbackToPrompting()).toBe(false);
  });
});
