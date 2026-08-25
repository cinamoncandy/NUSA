import type { ClosedCandle } from "../strategy/closedCandleAdapter";

export type ShadowCandleAdmission = "OK" | "NOT_CLOSED" | "DUPLICATE" | "OUT_OF_ORDER" | "STALE";

export interface ShadowCandleAdmissionSnapshot {
  readonly lastAdmittedCandleCloseTime?: number;
  readonly outOfOrderCandleCount: number;
  readonly duplicateCandleCount: number;
  readonly staleCandleCount: number;
  readonly dispatchedCandleCount: number;
}

/**
 * Owns Shadow-only closed-candle admission state.
 *
 * The production PAPER signal path remains outside this class. This tracker only decides
 * whether a closed candle is trustworthy enough to enter Shadow observation after the
 * production signal has already been emitted by ShadowOperationalRuntime.
 */
export class ShadowCandleAdmissionTracker {
  private lastAdmittedCandleCloseTime?: number;
  private outOfOrderCandleCount = 0;
  private duplicateCandleCount = 0;
  private staleCandleCount = 0;
  private readonly dispatchedCandleCloseTimes = new Set<number>();

  constructor(
    private readonly maxCandleAgeMs: number | undefined,
    private readonly now: () => number
  ) {}

  admit(candle: ClosedCandle): ShadowCandleAdmission {
    if (candle.closed !== true) return "NOT_CLOSED";
    if (this.dispatchedCandleCloseTimes.has(candle.closeTime)) {
      this.duplicateCandleCount += 1;
      return "DUPLICATE";
    }
    if (this.lastAdmittedCandleCloseTime !== undefined && candle.closeTime < this.lastAdmittedCandleCloseTime) {
      this.outOfOrderCandleCount += 1;
      return "OUT_OF_ORDER";
    }
    if (this.maxCandleAgeMs !== undefined && this.now() - candle.closeTime > this.maxCandleAgeMs) {
      this.staleCandleCount += 1;
      return "STALE";
    }
    return "OK";
  }

  commit(candle: ClosedCandle): void {
    this.lastAdmittedCandleCloseTime = candle.closeTime;
    this.dispatchedCandleCloseTimes.add(candle.closeTime);
  }

  reset(): void {
    this.lastAdmittedCandleCloseTime = undefined;
    this.outOfOrderCandleCount = 0;
    this.duplicateCandleCount = 0;
    this.staleCandleCount = 0;
    this.dispatchedCandleCloseTimes.clear();
  }

  snapshot(): ShadowCandleAdmissionSnapshot {
    return Object.freeze({
      lastAdmittedCandleCloseTime: this.lastAdmittedCandleCloseTime,
      outOfOrderCandleCount: this.outOfOrderCandleCount,
      duplicateCandleCount: this.duplicateCandleCount,
      staleCandleCount: this.staleCandleCount,
      dispatchedCandleCount: this.dispatchedCandleCloseTimes.size
    });
  }
}
