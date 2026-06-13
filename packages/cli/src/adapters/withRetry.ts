/**
 * Retry/backoff for model API calls — kept in the adapter so the agent loop stays
 * dumb. Retries transient failures (429/5xx, network resets) with exponential
 * backoff + jitter, honoring Retry-After; never retries 4xx auth/validation or an
 * abort. A retry callback lets the gateway surface live attempts as `api_retry`
 * events. Pure and injectable (sleep/random) so it's unit-testable without timers.
 */

export interface RetryInfo {
  attempt: number;
  maxRetries: number;
  delayMs: number;
  status?: number;
}

/** A failed HTTP response, carrying the status (and Retry-After, if any) for retry decisions. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Marks an error that must NOT be retried (e.g. a stream that already emitted output). */
export class NonRetryableError extends Error {
  constructor(readonly original: unknown) {
    super(original instanceof Error ? original.message : String(original));
    this.name = "NonRetryableError";
  }
}

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 529]);
const RETRYABLE_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "EPIPE", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

export function isRetryableError(err: unknown): boolean {
  if (err instanceof NonRetryableError) return false;
  if (err instanceof HttpError) return RETRYABLE_STATUS.has(err.status);
  const code = (err as { code?: string } | null)?.code;
  if (code && RETRYABLE_CODES.has(code)) return true;
  // A fetch network failure surfaces as TypeError("fetch failed" / "terminated").
  if (err instanceof TypeError && /fetch failed|network|terminated/i.test(err.message)) return true;
  return false;
}

/** Parse a Retry-After header (seconds or HTTP-date) into milliseconds. */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

export interface WithRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  onRetry?: (info: RetryInfo) => void;
  isRetryable?: (err: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn`, retrying transient failures. `fn` receives the 1-based attempt number.
 * The total number of ATTEMPTS is maxRetries + 1.
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: WithRetryOptions = {}): Promise<T> {
  const maxRetries = opts.maxRetries ?? 8;
  const base = opts.baseDelayMs ?? 500;
  const cap = opts.maxDelayMs ?? 30_000;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const retryable = opts.isRetryable ?? isRetryableError;
  let attempt = 0;
  for (;;) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      return await fn(attempt + 1);
    } catch (err) {
      attempt += 1;
      if (opts.signal?.aborted || isAbortError(err)) throw err; // never retry an abort
      if (attempt > maxRetries || !retryable(err)) throw err;
      const status = err instanceof HttpError ? err.status : undefined;
      const retryAfter = err instanceof HttpError ? err.retryAfterMs : undefined;
      const backoff = Math.min(base * 2 ** (attempt - 1), cap) + Math.floor(random() * 100);
      const delayMs = retryAfter ?? backoff;
      opts.onRetry?.({ attempt, maxRetries, delayMs, status });
      await sleep(delayMs);
    }
  }
}
