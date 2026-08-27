import type { ResearchCandle } from "../cloud/researchDataset";

/**
 * Shape of a single element from Upbit's public GET /v1/candles/days response.
 * https://docs.upbit.com -- public market data only, no API key required.
 */
export interface UpbitDayCandle {
  readonly market: string;
  readonly candle_date_time_utc: string;
  readonly opening_price: number;
  readonly high_price: number;
  readonly low_price: number;
  readonly trade_price: number;
  readonly candle_acc_trade_volume: number;
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

export interface UpbitDailyCandleFreshness {
  readonly asOf: number;
  readonly expectedLatestCloseTime: number;
  readonly actualLatestCloseTime: number;
  readonly lagDays: number;
  readonly fresh: boolean;
}

const DAY_MS = 86_400_000;

/**
 * Evaluates whether a completed UTC daily series reaches the latest interval that could have
 * fully closed by `asOf`. No arbitrary age threshold is used: freshness is aligned to the
 * exchange's UTC daily interval boundary. Callers decide whether a stale result is fatal.
 */
export function evaluateUpbitDailyCandleFreshness(
  candles: readonly ResearchCandle[],
  asOf: number,
): UpbitDailyCandleFreshness {
  if (!Number.isFinite(asOf)) throw new Error("asOf must be finite");
  if (candles.length === 0) throw new Error("daily candle freshness requires at least one candle");
  const actualLatestCloseTime = Math.max(...candles.map((candle) => candle.closeTime));
  const expectedLatestCloseTime = Math.floor(asOf / DAY_MS) * DAY_MS;
  if (!Number.isFinite(actualLatestCloseTime) || actualLatestCloseTime > asOf) {
    throw new Error("daily candle freshness requires completed finite candle timestamps");
  }
  const lagMs = expectedLatestCloseTime - actualLatestCloseTime;
  if (lagMs < 0 || lagMs % DAY_MS !== 0) {
    throw new Error("daily candle freshness requires UTC-aligned daily close timestamps");
  }
  return Object.freeze({
    asOf,
    expectedLatestCloseTime,
    actualLatestCloseTime,
    lagDays: lagMs / DAY_MS,
    fresh: lagMs === 0,
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
  options: MapUpbitDayCandlesOptions = {},
): readonly ResearchCandle[] {
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
      interval: "1d" as const,
      openTime,
      closeTime: openTime + DAY_MS,
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
