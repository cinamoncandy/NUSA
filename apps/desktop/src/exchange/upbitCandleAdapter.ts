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

const DAY_MS = 86_400_000;

/**
 * Converts Upbit's public daily-candle response into ResearchCandle records this
 * repository's research pipeline (researchDataset.ts) already validates and checksums.
 * Upbit returns most-recent-first; this always returns ascending by openTime, matching
 * the OPEN_TIME_ASC ordering createHistoricalDatasetManifest requires. Pure and
 * network-free: fetching the raw candles is the caller's responsibility.
 */
export function mapUpbitDayCandlesToResearchCandles(raw: readonly UpbitDayCandle[]): readonly ResearchCandle[] {
  if (raw.length === 0) throw new Error("upbit candle response is empty");
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
  return Object.freeze([...mapped].sort((left, right) => left.openTime - right.openTime));
}
