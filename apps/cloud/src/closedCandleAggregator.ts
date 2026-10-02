import { createHash } from "node:crypto";
import type { BacktestCandle } from "../../../packages/core/src/optimizer/aiBacktestEngine";

/**
 * Deterministic aggregation of stored public ticker observations into CLOSED fixed-interval candles.
 *
 * - Only candles whose whole bucket has ended (bucketStart + interval <= nowMs) are returned.
 * - A bucket with no observation yields no candle: gaps are counted, never forward-filled or interpolated.
 * - Invalid or out-of-order observations are skipped and counted, never repaired.
 * - Ticker observations carry no per-candle traded volume, so `volume` is always 0; consumers must not use it.
 * - `checksumSha256` is the SHA-256 of the canonical candle list, usable as dataset content identity.
 */
export const DEFAULT_CANDLE_INTERVAL_MS = 60_000;

export interface CandleObservation {
  readonly observedAt: number;
  readonly price: number;
}

export interface AggregatedCandles {
  readonly intervalMs: number;
  readonly candles: readonly BacktestCandle[];
  readonly missingBuckets: number;
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
  readonly intervalMs?: number;
}): AggregatedCandles {
  const intervalMs = input.intervalMs ?? DEFAULT_CANDLE_INTERVAL_MS;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000 || intervalMs > 86_400_000) throw new Error("candle interval is invalid");
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs <= 0) throw new Error("candle aggregation clock is invalid");

  let rejected = 0;
  let lastAcceptedAt = -Infinity;
  const buckets = new Map<number, { open: number; high: number; low: number; close: number }>();
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
    if (bucket == null) buckets.set(start, { open: price, high: price, low: price, close: price });
    else {
      bucket.high = Math.max(bucket.high, price);
      bucket.low = Math.min(bucket.low, price);
      bucket.close = price;
    }
  }

  const starts = [...buckets.keys()].sort((a, b) => a - b);
  const candles = starts.map((start): BacktestCandle => {
    const b = buckets.get(start) as { open: number; high: number; low: number; close: number };
    return Object.freeze({ timestamp: start, open: b.open, high: b.high, low: b.low, close: b.close, volume: 0 });
  });
  const missingBuckets = starts.length < 2 ? 0 : (starts[starts.length - 1] - starts[0]) / intervalMs + 1 - starts.length;
  return Object.freeze({ intervalMs, candles: Object.freeze(candles), missingBuckets, rejectedObservations: rejected, checksumSha256: candleChecksum(candles) });
}
