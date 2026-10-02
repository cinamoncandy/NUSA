import { createHash } from "node:crypto";
import type { BacktestCandle } from "../../../packages/core/src/optimizer/aiBacktestEngine";

/**
 * Deterministic aggregation of stored public ticker observations into CLOSED fixed-interval candles.
 *
 * - Only candles whose whole bucket has ended (bucketStart + interval <= nowMs) are returned.
 * - `BacktestCandle.timestamp` is the candle CLOSE time (bucketStart + interval), i.e. when its high, low and
 *   close became knowable, so point-in-time consumers such as the backtest engine never see it early.
 * - A bucket is emitted only with proven observation coverage: it must begin at or after `coverageStartMs`
 *   (the time from which the observation store is known to be complete) and no gap between the bucket start,
 *   its ticks and the bucket end may exceed `maxInternalGapMs`. Buckets that fail are dropped and counted as
 *   `incompleteBuckets` (a window that starts mid-minute, or a feed outage inside a minute, never becomes a
 *   candle with a truncated open/high/low).
 * - A bucket with no observation yields no candle: gaps are counted, never forward-filled or interpolated.
 * - Invalid or out-of-order observations are skipped and counted, never repaired.
 * - Ticker observations carry no per-candle traded volume, so `volume` is always 0; consumers must not use it.
 * - `checksumSha256` is the SHA-256 of the canonical candle list, usable as dataset content identity.
 */
export const DEFAULT_CANDLE_INTERVAL_MS = 60_000;
export const DEFAULT_MAX_INTERNAL_GAP_MS = 30_000;

export interface CandleObservation {
  readonly observedAt: number;
  readonly price: number;
}

export interface AggregatedCandles {
  readonly intervalMs: number;
  readonly candles: readonly BacktestCandle[];
  readonly missingBuckets: number;
  readonly incompleteBuckets: number;
  readonly rejectedObservations: number;
  readonly checksumSha256: string;
}

export function candleChecksum(candles: readonly BacktestCandle[]): string {
  const canonical = candles.map((c) => [c.timestamp, c.open, c.high, c.low, c.close, c.volume]);
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

export function aggregateClosedCandles(input: {
  readonly observations: readonly CandleObservation[];
  readonly nowMs: number;
  /** Time from which the observation store is known to be complete; earlier buckets are never emitted. */
  readonly coverageStartMs: number;
  readonly intervalMs?: number;
  readonly maxInternalGapMs?: number;
}): AggregatedCandles {
  const intervalMs = input.intervalMs ?? DEFAULT_CANDLE_INTERVAL_MS;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000 || intervalMs > 86_400_000) throw new Error("candle interval is invalid");
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs <= 0) throw new Error("candle aggregation clock is invalid");
  if (!Number.isSafeInteger(input.coverageStartMs) || input.coverageStartMs <= 0) throw new Error("candle coverage start is invalid");
  const maxGap = input.maxInternalGapMs ?? DEFAULT_MAX_INTERNAL_GAP_MS;
  if (!Number.isSafeInteger(maxGap) || maxGap < 1 || maxGap > intervalMs) throw new Error("candle maximum internal gap is invalid");

  let rejected = 0;
  let lastAcceptedAt = -Infinity;
  const buckets = new Map<number, { open: number; high: number; low: number; close: number; firstAt: number; lastAt: number; maxGap: number }>();
  for (const observation of input.observations) {
    const { observedAt, price } = observation;
    if (!Number.isSafeInteger(observedAt) || observedAt <= 0 || !Number.isFinite(price) || price <= 0 || observedAt < lastAcceptedAt) {
      rejected += 1;
      continue;
    }
    lastAcceptedAt = observedAt;
    const start = Math.floor(observedAt / intervalMs) * intervalMs;
    if (start + intervalMs > input.nowMs) continue; // bucket still open: not a closed candle
    const bucket = buckets.get(start);
    if (bucket == null) buckets.set(start, { open: price, high: price, low: price, close: price, firstAt: observedAt, lastAt: observedAt, maxGap: observedAt - start });
    else {
      bucket.high = Math.max(bucket.high, price);
      bucket.low = Math.min(bucket.low, price);
      bucket.close = price;
      bucket.maxGap = Math.max(bucket.maxGap, observedAt - bucket.lastAt);
      bucket.lastAt = observedAt;
    }
  }

  let incomplete = 0;
  const starts: number[] = [];
  for (const start of [...buckets.keys()].sort((a, b) => a - b)) {
    const b = buckets.get(start) as { lastAt: number; maxGap: number };
    const tailGap = start + intervalMs - b.lastAt;
    if (start < input.coverageStartMs || b.maxGap > maxGap || tailGap > maxGap) incomplete += 1;
    else starts.push(start);
  }
  const candles = starts.map((start): BacktestCandle => {
    const b = buckets.get(start) as { open: number; high: number; low: number; close: number };
    return Object.freeze({ timestamp: start + intervalMs, open: b.open, high: b.high, low: b.low, close: b.close, volume: 0 });
  });
  const missingBuckets = starts.length < 2 ? 0 : (starts[starts.length - 1] - starts[0]) / intervalMs + 1 - starts.length;
  return Object.freeze({ intervalMs, candles: Object.freeze(candles), missingBuckets, incompleteBuckets: incomplete, rejectedObservations: rejected, checksumSha256: candleChecksum(candles) });
}
