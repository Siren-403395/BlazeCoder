/**
 * Denial-loop protection — stops a model from burning every turn retrying the same
 * denied action. After enough consecutive (or total) denials we inject a corrective
 * message so it changes approach instead of thrashing to the turn cap.
 */

export const DENIAL_LIMITS = { maxConsecutive: 3, maxTotal: 20 };

export class DenialTracker {
  private consecutive = 0;
  private total = 0;

  recordDenial(): void {
    this.consecutive += 1;
    this.total += 1;
  }

  /** Any allowed tool call breaks the consecutive streak. */
  recordSuccess(): void {
    this.consecutive = 0;
  }

  shouldFallbackToPrompting(): boolean {
    return this.consecutive >= DENIAL_LIMITS.maxConsecutive || this.total >= DENIAL_LIMITS.maxTotal;
  }

  /** Reset the consecutive streak after the corrective nudge is delivered. */
  reset(): void {
    this.consecutive = 0;
  }
}
