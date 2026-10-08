import type { ResearchCandleRow } from "./backtestResearchEvaluator";

/** Closed-candle store operations the research orchestrator reads, keyed by (market, intervalMs). */
export interface ResearchCandleStorePort {
  read(market: string, intervalMs: number, fromCloseMs: number, toCloseMs: number): readonly ResearchCandleRow[];
  latestCloseTime(market: string, intervalMs: number): number | undefined;
  earliestCloseTime(market: string, intervalMs: number): number | undefined;
  count(market: string, intervalMs: number): number;
}

/**
 * Serves longer research bars (for example 60m) built from the stored closed base candles (1m). A bar covering
 * (close - interval, close] is emitted only when every base candle in it is present, so a gap never becomes a
 * synthetic bar: it stays missing and the walk-forward missing-data gate decides. Requests for the base interval
 * pass through unchanged. Read-only; nothing is written back to the store.
 */
export class AggregatedResearchCandleSource implements ResearchCandleStorePort {
  public constructor(private readonly base: ResearchCandleStorePort, private readonly baseIntervalMs: number) {
    if (!Number.isSafeInteger(baseIntervalMs) || baseIntervalMs <= 0) throw new Error("research base interval is invalid");
  }

  private ratio(intervalMs: number): number {
    const ratio = intervalMs / this.baseIntervalMs;
    if (!Number.isSafeInteger(intervalMs) || !Number.isSafeInteger(ratio) || ratio < 1) throw new Error("research interval must be a whole multiple of the base interval");
    return ratio;
  }

  public read(market: string, intervalMs: number, fromCloseMs: number, toCloseMs: number): readonly ResearchCandleRow[] {
    const ratio = this.ratio(intervalMs);
    if (ratio === 1) return this.base.read(market, intervalMs, fromCloseMs, toCloseMs);
    const firstClose = Math.ceil(fromCloseMs / intervalMs) * intervalMs;
    const lastClose = Math.floor(toCloseMs / intervalMs) * intervalMs;
    if (lastClose < firstClose) return Object.freeze([]);
    const rows = this.base.read(market, this.baseIntervalMs, firstClose - intervalMs + this.baseIntervalMs, lastClose);
    const bars: ResearchCandleRow[] = [];
    let bucket: ResearchCandleRow[] = [];
    let bucketClose = Number.NaN;
    const flush = (): void => {
      if (bucket.length !== ratio) return;
      bars.push(Object.freeze({
        closeTimeMs: bucketClose,
        open: bucket[0]!.open,
        high: Math.max(...bucket.map((row) => row.high)),
        low: Math.min(...bucket.map((row) => row.low)),
        close: bucket[bucket.length - 1]!.close,
      }));
    };
    for (const row of rows) {
      const close = Math.ceil(row.closeTimeMs / intervalMs) * intervalMs;
      if (close !== bucketClose) {
        flush();
        bucket = [];
        bucketClose = close;
      }
      bucket.push(row);
    }
    flush();
    return Object.freeze(bars);
  }

  public latestCloseTime(market: string, intervalMs: number): number | undefined {
    if (this.ratio(intervalMs) === 1) return this.base.latestCloseTime(market, intervalMs);
    const latest = this.base.latestCloseTime(market, this.baseIntervalMs);
    if (latest == null) return undefined;
    const bars = this.read(market, intervalMs, latest - 2 * intervalMs, latest);
    return bars.length === 0 ? undefined : bars[bars.length - 1]!.closeTimeMs;
  }

  public earliestCloseTime(market: string, intervalMs: number): number | undefined {
    if (this.ratio(intervalMs) === 1) return this.base.earliestCloseTime(market, intervalMs);
    const earliest = this.base.earliestCloseTime(market, this.baseIntervalMs);
    if (earliest == null) return undefined;
    const bars = this.read(market, intervalMs, earliest, earliest + 2 * intervalMs);
    return bars.length === 0 ? undefined : bars[0]!.closeTimeMs;
  }

  public count(market: string, intervalMs: number): number {
    if (this.ratio(intervalMs) === 1) return this.base.count(market, intervalMs);
    const earliest = this.base.earliestCloseTime(market, this.baseIntervalMs);
    const latest = this.base.latestCloseTime(market, this.baseIntervalMs);
    if (earliest == null || latest == null) return 0;
    return this.read(market, intervalMs, earliest, latest).length;
  }
}
