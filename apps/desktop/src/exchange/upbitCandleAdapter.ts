import type { ResearchCandle, ResearchInterval } from "../cloud/researchDataset";

/**
 * Shape of a single element from Upbit's public GET /v1/candles/days response.
 * https://docs.upbit.com -- public market data only, no API key required.
 */
/**
 * Upbit intervals this adapter can map. The research dataset already validates and checksums
 * every one of these (researchDataset.ts INTERVAL_MS); only this adapter and the run script
 * were previously locked to daily candles.
 */
export type UpbitResearchInterval = Extract<ResearchInterval, "1d" | "60m" | "240m">;

export const UPBIT_INTERVAL_MS: Readonly<Record<UpbitResearchInterval, number>> = Object.freeze({
  "1d": 86_400_000,
  "60m": 3_600_000,
  "240m": 14_400_000,
});

/** Public request path for one interval. Minute candles use a different Upbit endpoint. */
export function upbitCandleRequestPath(interval: UpbitResearchInterval): string {
  if (interval === "1d") return "/v1/candles/days";
  if (interval === "60m") return "/v1/candles/minutes/60";
  return "/v1/candles/minutes/240";
}

export interface UpbitDayCandle {
  readonly market: string;
  readonly candle_date_time_utc: string;
  readonly opening_price: number;
  readonly high_price: number;
  readonly low_price: number;
  readonly trade_price: number;
  readonly candle_acc_trade_volume: number;
}

export interface MapUpbitCandlesOptions extends MapUpbitDayCandlesOptions {
  /** Interval the raw response was fetched at. Defaults to the historical daily behaviour. */
  readonly interval?: UpbitResearchInterval;
}

export interface MapUpbitDayCandlesOptions {
  /**
   * When provided, only candles whose full UTC day has closed by this timestamp are returned.
   * This prevents an in-progress daily candle from entering a historical research manifest.
   */
  readonly completedBy?: number;
  /** Keep only the most recent N completed candles after point-in-time filtering. */
  readonly maxCount?: number;
}

export interface UpbitCandleFreshness {
  readonly asOf: number;
  readonly expectedLatestCloseTime: number;
  readonly actualLatestCloseTime: number;
  /** Whole intervals by which the series trails the latest interval that could have closed. */
  readonly lagIntervals: number;
  readonly fresh: boolean;
}

export interface UpbitDailyCandleFreshness {
  readonly asOf: number;
  readonly expectedLatestCloseTime: number;
  readonly actualLatestCloseTime: number;
  readonly lagDays: number;
  readonly fresh: boolean;
}


/**
 * Evaluates whether a completed UTC daily series reaches the latest interval that could have
 * fully closed by `asOf`. No arbitrary age threshold is used: freshness is aligned to the
 * exchange's UTC daily interval boundary. Callers decide whether a stale result is fatal.
 */
export function evaluateUpbitCandleFreshness(
  candles: readonly ResearchCandle[],
  asOf: number,
  interval: UpbitResearchInterval = "1d",
): UpbitCandleFreshness {
  const intervalMs = UPBIT_INTERVAL_MS[interval];
  if (!Number.isFinite(asOf)) throw new Error("asOf must be finite");
  if (candles.length === 0) throw new Error("candle freshness requires at least one candle");
  const actualLatestCloseTime = Math.max(...candles.map((candle) => candle.closeTime));
  const expectedLatestCloseTime = Math.floor(asOf / intervalMs) * intervalMs;
  if (!Number.isFinite(actualLatestCloseTime) || actualLatestCloseTime > asOf) {
    throw new Error("candle freshness requires completed finite candle timestamps");
  }
  const lagMs = expectedLatestCloseTime - actualLatestCloseTime;
  if (lagMs < 0 || lagMs % intervalMs !== 0) {
    throw new Error("candle freshness requires UTC-aligned interval close timestamps");
  }
  return Object.freeze({
    asOf,
    expectedLatestCloseTime,
    actualLatestCloseTime,
    lagIntervals: lagMs / intervalMs,
    fresh: lagMs === 0,
  });
}

/** Daily-named wrapper kept so existing callers and their error strings are unchanged. */
export function evaluateUpbitDailyCandleFreshness(
  candles: readonly ResearchCandle[],
  asOf: number,
): UpbitDailyCandleFreshness {
  const generic = evaluateUpbitCandleFreshness(candles, asOf, "1d");
  return Object.freeze({
    asOf: generic.asOf,
    expectedLatestCloseTime: generic.expectedLatestCloseTime,
    actualLatestCloseTime: generic.actualLatestCloseTime,
    lagDays: generic.lagIntervals,
    fresh: generic.fresh,
  });
}

/**
 * Converts Upbit's public daily-candle response into ResearchCandle records this
 * repository's research pipeline (researchDataset.ts) already validates and checksums.
 * Upbit returns most-recent-first; this always returns ascending by openTime, matching
 * the OPEN_TIME_ASC ordering createHistoricalDatasetManifest requires. Pure and
 * network-free: fetching the raw candles is the caller's responsibility.
 */
export function mapUpbitDayCandlesToResearchCandles(
  raw: readonly UpbitDayCandle[],
  options: MapUpbitCandlesOptions = {},
): readonly ResearchCandle[] {
  const interval = options.interval ?? "1d";
  const intervalMs = UPBIT_INTERVAL_MS[interval];
  if (raw.length === 0) throw new Error("upbit candle response is empty");
  if (options.completedBy != null && !Number.isFinite(options.completedBy)) {
    throw new Error("completedBy must be finite when provided");
  }
  if (options.maxCount != null && (!Number.isInteger(options.maxCount) || options.maxCount <= 0)) {
    throw new Error("maxCount must be a positive integer when provided");
  }

  const mapped = raw.map((candle, index) => {
    if (!candle.market || typeof candle.market !== "string") throw new Error(`upbit candle ${index} is missing market`);
    const openTime = Date.parse(`${candle.candle_date_time_utc}Z`);
    if (!Number.isFinite(openTime)) throw new Error(`upbit candle ${index} has an invalid candle_date_time_utc`);
    for (const [name, value] of [
      ["opening_price", candle.opening_price],
      ["high_price", candle.high_price],
      ["low_price", candle.low_price],
      ["trade_price", candle.trade_price]
    ] as const) {
      if (!Number.isFinite(value) || value <= 0) throw new Error(`upbit candle ${index} ${name} must be positive and finite`);
    }
    if (!Number.isFinite(candle.candle_acc_trade_volume) || candle.candle_acc_trade_volume < 0) {
      throw new Error(`upbit candle ${index} candle_acc_trade_volume must be finite and non-negative`);
    }
    return Object.freeze({
      market: candle.market,
      interval,
      openTime,
      closeTime: openTime + intervalMs,
      open: candle.opening_price,
      high: candle.high_price,
      low: candle.low_price,
      close: candle.trade_price,
      volume: candle.candle_acc_trade_volume
    });
  });

  const completed = options.completedBy == null
    ? mapped
    : mapped.filter((candle) => candle.closeTime <= options.completedBy!);
  if (completed.length === 0) throw new Error("upbit candle response contains no completed daily candles");
  const ordered = [...completed].sort((left, right) => left.openTime - right.openTime);
  const bounded = options.maxCount == null ? ordered : ordered.slice(-options.maxCount);
  return Object.freeze(bounded);
}
