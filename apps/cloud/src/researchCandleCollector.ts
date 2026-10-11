import { aggregateClosedCandles, DEFAULT_CANDLE_INTERVAL_MS, type CandleObservation } from "./closedCandleAggregator";
import type { StoredResearchCandle } from "../../../packages/storage/src/researchCandleStore";

/**
 * One collection pass: stored ticker observations -> closed candles -> durable candle store.
 * Ports are injected so the pass is deterministic and testable; nothing here starts a timer or touches a
 * runtime (composition is a later, owner-approved stage). A failure on one market never stops the others and
 * is reported, never thrown, unless the pass itself is misconfigured.
 *
 * Coverage rule: if candles are already stored for a market, collection resumes exactly at the last stored
 * close time (continuity) as long as the retained observations still reach back to that resume point, i.e. the
 * first retained observation falls inside the first bucket after it. If the retained observations start later
 * (server down, or older ticks pruned by the row cap) the oldest retained bucket may be truncated, so it is
 * skipped exactly like the first bucket of a first run. Skipped buckets are simply never stored.
 */
export interface ObservationReader {
  readWindow(market: string, startAt: number, endAt: number): readonly CandleObservation[];
}

export interface CandleSink {
  latestCloseTime(market: string, intervalMs: number): number | undefined;
  append(market: string, intervalMs: number, candles: readonly StoredResearchCandle[]): number;
}

export interface MarketCollectionResult {
  readonly market: string;
  readonly status: "COLLECTED" | "NO_OBSERVATIONS" | "ERROR";
  readonly recorded: number;
  readonly incompleteBuckets: number;
  readonly missingBuckets: number;
  readonly rejectedObservations: number;
  readonly errorCode?: string;
}

export function collectClosedCandles(input: {
  readonly markets: readonly string[];
  readonly nowMs: number;
  readonly observations: ObservationReader;
  readonly sink: CandleSink;
  readonly intervalMs?: number;
}): readonly MarketCollectionResult[] {
  const intervalMs = input.intervalMs ?? DEFAULT_CANDLE_INTERVAL_MS;
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs <= 0) throw new Error("candle collection clock is invalid");
  if (!Array.isArray(input.markets) || input.markets.length === 0 || input.markets.length > 200) throw new Error("candle collection markets are invalid");
  if (new Set(input.markets).size !== input.markets.length) throw new Error("candle collection markets must be unique");

  return Object.freeze(input.markets.map((market): MarketCollectionResult => {
    try {
      const latest = input.sink.latestCloseTime(market, intervalMs);
      const readFrom = latest ?? 1;
      const observations = input.observations.readWindow(market, readFrom, input.nowMs);
      if (observations.length === 0) return Object.freeze({ market, status: "NO_OBSERVATIONS", recorded: 0, incompleteBuckets: 0, missingBuckets: 0, rejectedObservations: 0 });
      const first = observations.reduce((min, o) => Math.min(min, o.observedAt), Infinity);
      const continuous = latest != null && first < latest + intervalMs;
      // Continuous history resumes at the last close; otherwise the oldest retained bucket may be truncated: skip it.
      const coverageStartMs = continuous ? (latest as number) : (Math.floor(first / intervalMs) + 1) * intervalMs;
      const aggregated = aggregateClosedCandles({ observations, nowMs: input.nowMs, coverageStartMs, intervalMs });
      const fresh = aggregated.candles
        .filter((candle) => latest == null || candle.timestamp > latest)
        .map((candle): StoredResearchCandle => ({ closeTimeMs: candle.timestamp, open: candle.open, high: candle.high, low: candle.low, close: candle.close }));
      const recorded = fresh.length === 0 ? 0 : input.sink.append(market, intervalMs, fresh);
      return Object.freeze({ market, status: "COLLECTED", recorded, incompleteBuckets: aggregated.incompleteBuckets, missingBuckets: aggregated.missingBuckets, rejectedObservations: aggregated.rejectedObservations });
    } catch (error) {
      const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "COLLECTION_FAILED";
      return Object.freeze({ market, status: "ERROR", recorded: 0, incompleteBuckets: 0, missingBuckets: 0, rejectedObservations: 0, errorCode: code });
    }
  }));
}
