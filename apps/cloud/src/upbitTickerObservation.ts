import type { IntelligenceObservation } from "./marketIntelligenceFusion";
import type { UpbitTicker } from "./upbitWebSocket";
import {
  CHART_NORMALIZATION_V1,
  CHART_NORMALIZATION_V1_FINGERPRINT,
  normalizeChartChangeRate
} from "./chartSignalNormalization";

export const DEFAULT_UPBIT_TICKER_STALE_WINDOW_MS = 30_000;
/**
 * How far ahead of this machine's clock an exchange timestamp may sit before the tick is treated
 * as implausible rather than as ordinary clock skew. Desktop clocks drift, and NTP is not
 * guaranteed; without this allowance a sub-second lag silently discards the entire public feed.
 */
export const DEFAULT_UPBIT_TICKER_CLOCK_SKEW_TOLERANCE_MS = 5_000;
/** Compatibility export; the policy now belongs to the exchange-agnostic chart normalization module. */
export const UPBIT_CHART_NORMALIZATION_POLICY = CHART_NORMALIZATION_V1;
const MAX_QUOTE_TURNOVER_FOR_FULL_CONFIDENCE = 1_000_000_000;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

/** Compatibility wrapper for callers that previously imported normalization from the Upbit adapter. */
export function normalizeUpbitChartChangeRate(rawChangeRate: number): number {
  return normalizeChartChangeRate(rawChangeRate, CHART_NORMALIZATION_V1);
}

export interface UpbitTickerObservationOptions {
  readonly now: number;
  readonly staleWindowMs?: number;
  /** Allowance for benign exchange/local clock skew. See DEFAULT_UPBIT_TICKER_CLOCK_SKEW_TOLERANCE_MS. */
  readonly clockSkewToleranceMs?: number;
}

/**
 * Per-tick rejection reason for operators. ACCEPTED mirrors exactly the cases
 * where {@link upbitTickerToIntelligenceObservation} returns an observation;
 * every other code maps 1:1 to a refusal branch (pinned by consistency test).
 *
 * HOST_CLOCK_AHEAD / HOST_CLOCK_BEHIND are deliberately absent: a single tick
 * cannot distinguish a stale feed from a skewed host clock. Only a series of
 * live-but-stale ticks suggests clock suspect, which needs stateful tracking
 * outside this pure function. Safety behavior is identical for all rejections.
 */
export type TickerRejectReason =
  | "ACCEPTED"
  | "NOT_TICKER"
  | "MARKET_MISMATCH"
  | "FUTURE_MARKET_TIMESTAMP"
  | "FEED_STALE";

export function classifyTickerRejectReason(
  ticker: UpbitTicker,
  options: UpbitTickerObservationOptions
): TickerRejectReason {
  const staleWindowMs = options.staleWindowMs ?? DEFAULT_UPBIT_TICKER_STALE_WINDOW_MS;
  const skewToleranceMs = options.clockSkewToleranceMs ?? DEFAULT_UPBIT_TICKER_CLOCK_SKEW_TOLERANCE_MS;
  if (!Number.isSafeInteger(options.now) || options.now < 0) throw new Error("now must be a non-negative safe integer");
  if (!Number.isSafeInteger(staleWindowMs) || staleWindowMs < 1_000) throw new Error("staleWindowMs must be >= 1000");
  if (!Number.isSafeInteger(skewToleranceMs) || skewToleranceMs < 0) throw new Error("clockSkewToleranceMs must be a non-negative safe integer");
  if (ticker.type !== "ticker") return "NOT_TICKER";
  if (!ticker.code.startsWith("KRW-")) return "MARKET_MISMATCH";
  if (ticker.trade_timestamp > options.now + skewToleranceMs) return "FUTURE_MARKET_TIMESTAMP";
  const age = Math.max(0, options.now - ticker.trade_timestamp);
  if (age > staleWindowMs) return "FEED_STALE";
  return "ACCEPTED";
}

/** Converts one accepted public ticker into bounded, read-only intelligence evidence. */
export function upbitTickerToIntelligenceObservation(
  ticker: UpbitTicker,
  options: UpbitTickerObservationOptions
): IntelligenceObservation | undefined {
  const staleWindowMs = options.staleWindowMs ?? DEFAULT_UPBIT_TICKER_STALE_WINDOW_MS;
  if (!Number.isSafeInteger(options.now) || options.now < 0) throw new Error("now must be a non-negative safe integer");
  if (!Number.isSafeInteger(staleWindowMs) || staleWindowMs < 1_000) throw new Error("staleWindowMs must be >= 1000");
  const skewToleranceMs = options.clockSkewToleranceMs ?? DEFAULT_UPBIT_TICKER_CLOCK_SKEW_TOLERANCE_MS;
  if (!Number.isSafeInteger(skewToleranceMs) || skewToleranceMs < 0) throw new Error("clockSkewToleranceMs must be a non-negative safe integer");
  if (ticker.type !== "ticker" || !ticker.code.startsWith("KRW-")) return undefined;
  // Future-dated data is refused, but only beyond a tolerance. The exchange clock and this
  // machine's clock are independent and routinely differ by a few hundred milliseconds; an
  // exact comparison rejected every genuine tick whenever the local clock lagged even slightly,
  // which produced no market intelligence at all and left the PAPER kill switch closed. The
  // tolerance is small relative to the staleness window, so implausibly future-dated data is
  // still refused.
  if (ticker.trade_timestamp > options.now + skewToleranceMs) return undefined;
  // A tick that is barely "ahead" of us is treated as current rather than as negatively aged.
  const age = Math.max(0, options.now - ticker.trade_timestamp);
  if (age > staleWindowMs) return undefined;
  const signedChangeRate = ticker.signed_change_rate ?? 0;
  const turnover = ticker.acc_trade_price_24h ?? 0;
  const freshness = clamp(1 - age / staleWindowMs, 0, 1);
  const turnoverConfidence = clamp(turnover / MAX_QUOTE_TURNOVER_FOR_FULL_CONFIDENCE, 0, 1);
  const confidence = round4(freshness * turnoverConfidence);
  const signedPercent = round4(clamp(signedChangeRate, -1, 1) * 100);
  const normalizedScore = normalizeUpbitChartChangeRate(signedChangeRate);
  return Object.freeze({
    id: `${ticker.code}:${ticker.trade_timestamp}`,
    source: "CHART" as const,
    market: ticker.code,
    price: ticker.trade_price,
    sentiment: normalizedScore,
    rawChangeRate: signedChangeRate,
    normalizationPolicyId: CHART_NORMALIZATION_V1.id,
    normalizationPolicyFingerprint: CHART_NORMALIZATION_V1_FINGERPRINT,
    confidence,
    observedAt: ticker.trade_timestamp,
    expiresAt: ticker.trade_timestamp + staleWindowMs,
    summary: `${ticker.code} ${ticker.trade_price} (${signedPercent >= 0 ? "+" : ""}${signedPercent}%)`
  });
}
