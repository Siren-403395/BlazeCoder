import { describe, expect, it } from "vitest";
import { basename, dirname, formatDuration, formatTokens, formatUsd, percent } from "@/lib/format";

describe("formatTokens", () => {
  it("scales to k / M", () => {
    expect(formatTokens(512)).toBe("512");
    expect(formatTokens(1000)).toBe("1k");
    expect(formatTokens(12_300)).toBe("12.3k");
    expect(formatTokens(1_240_000)).toBe("1.2M");
  });
});

describe("formatUsd", () => {
  it("uses 4 decimals for tiny costs, 2 otherwise", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.0123)).toBe("$0.0123");
    expect(formatUsd(1.2)).toBe("$1.20");
  });
});

describe("formatDuration", () => {
  it("renders ms / s / m s", () => {
    expect(formatDuration(120)).toBe("120ms");
    expect(formatDuration(1240)).toBe("1.2s");
    expect(formatDuration(64_200)).toBe("1m 4s");
    expect(formatDuration(-5)).toBe("0ms");
  });
});

describe("percent", () => {
  it("clamps to 0..100", () => {
    expect(percent(30, 100)).toBe(30);
    expect(percent(0, 0)).toBe(0);
    expect(percent(200, 100)).toBe(100);
    expect(percent(-5, 100)).toBe(0);
  });
});

describe("path helpers", () => {
  it("splits base and dir", () => {
    expect(basename("/src/components/Button.tsx")).toBe("Button.tsx");
    expect(dirname("/src/components/Button.tsx")).toBe("/src/components");
    expect(dirname("/index.html")).toBe("/");
  });
});
