import type { IntelligenceObservation } from "./marketIntelligenceFusion";
import type { UpbitTicker } from "./upbitWebSocket";

export const DEFAULT_UPBIT_TICKER_STALE_WINDOW_MS = 30_000;
const MAX_QUOTE_TURNOVER_FOR_FULL_CONFIDENCE = 1_000_000_000;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

export interface UpbitTickerObservationOptions {
  readonly now: number;
  readonly staleWindowMs?: number;
}

/** Converts one accepted public ticker into bounded, read-only intelligence evidence. */
export function upbitTickerToIntelligenceObservation(
  ticker: UpbitTicker,
  options: UpbitTickerObservationOptions
): IntelligenceObservation | undefined {
  const staleWindowMs = options.staleWindowMs ?? DEFAULT_UPBIT_TICKER_STALE_WINDOW_MS;
  if (!Number.isSafeInteger(options.now) || options.now < 0) throw new Error("now must be a non-negative safe integer");
  if (!Number.isSafeInteger(staleWindowMs) || staleWindowMs < 1_000) throw new Error("staleWindowMs must be >= 1000");
  if (ticker.type !== "ticker" || !ticker.code.startsWith("KRW-") || ticker.trade_timestamp > options.now) return undefined;
  const age = options.now - ticker.trade_timestamp;
  if (age > staleWindowMs) return undefined;
  const signedChangeRate = ticker.signed_change_rate ?? 0;
  const turnover = ticker.acc_trade_price_24h ?? 0;
  const freshness = clamp(1 - age / staleWindowMs, 0, 1);
  const turnoverConfidence = clamp(turnover / MAX_QUOTE_TURNOVER_FOR_FULL_CONFIDENCE, 0, 1);
  const confidence = round4(freshness * turnoverConfidence);
  const signedPercent = round4(clamp(signedChangeRate, -1, 1) * 100);
  return Object.freeze({
    id: `${ticker.code}:${ticker.trade_timestamp}`,
    source: "CHART" as const,
    market: ticker.code,
    sentiment: round4(clamp(signedChangeRate, -1, 1)),
    confidence,
    observedAt: ticker.trade_timestamp,
    expiresAt: ticker.trade_timestamp + staleWindowMs,
    summary: `${ticker.code} ${ticker.trade_price} (${signedPercent >= 0 ? "+" : ""}${signedPercent}%)`
  });
}
