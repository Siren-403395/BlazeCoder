import { describe, expect, it, vi } from "vitest";
import {
  HttpError,
  isRetryableError,
  NonRetryableError,
  parseRetryAfter,
  withRetry,
} from "../src/adapters/withRetry";

const noSleep = async () => {};
const opts = { sleep: noSleep, random: () => 0, baseDelayMs: 1 };

describe("isRetryableError", () => {
  it("retries 429/5xx and network codes, not 4xx or NonRetryable", () => {
    expect(isRetryableError(new HttpError(503, "x"))).toBe(true);
    expect(isRetryableError(new HttpError(429, "x"))).toBe(true);
    expect(isRetryableError(new HttpError(400, "x"))).toBe(false);
    expect(isRetryableError(new HttpError(401, "x"))).toBe(false);
    expect(isRetryableError(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe(true);
    expect(isRetryableError(new NonRetryableError(new HttpError(503, "x")))).toBe(false);
  });
});

describe("parseRetryAfter", () => {
  it("parses seconds and HTTP-date", () => {
    expect(parseRetryAfter("2")).toBe(2000);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("Wed, 21 Oct 2099 07:28:00 GMT", Date.parse("Wed, 21 Oct 2099 07:27:59 GMT"))).toBe(1000);
  });
});

describe("withRetry", () => {
  it("retries a 503 once then succeeds, reporting the retry", async () => {
    const onRetry = vi.fn();
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls === 1) throw new HttpError(503, "service unavailable");
        return "ok";
      },
      { ...opts, onRetry },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0]![0]).toMatchObject({ attempt: 1, status: 503 });
  });

  it("does not retry a 4xx", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new HttpError(400, "bad request");
      }, opts),
    ).rejects.toBeInstanceOf(HttpError);
    expect(calls).toBe(1);
  });

  it("gives up after maxRetries", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new HttpError(503, "down");
      }, { ...opts, maxRetries: 2 }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(calls).toBe(3); // initial + 2 retries
  });

  it("never retries once aborted", async () => {
    const controller = new AbortController();
    let calls = 0;
    const p = withRetry(
      async () => {
        calls++;
        controller.abort();
        throw new HttpError(503, "down");
      },
      { ...opts, signal: controller.signal },
    );
    await expect(p).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("does not retry a NonRetryableError (stream already emitted)", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new NonRetryableError(new HttpError(503, "mid-stream"));
      }, opts),
    ).rejects.toBeInstanceOf(NonRetryableError);
    expect(calls).toBe(1);
  });
});
