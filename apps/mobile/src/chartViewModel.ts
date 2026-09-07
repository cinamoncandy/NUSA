export type ChartInterval = "1m" | "5m" | "15m" | "1h";
export type ChartState = "LOADING" | "EMPTY" | "ERROR" | "READY";

const ONE_MINUTE_MS = 60_000;
const INTERVAL_MINUTES: Readonly<Record<ChartInterval, number>> = Object.freeze({ "1m": 1, "5m": 5, "15m": 15, "1h": 60 });

export interface PublicCandle {
  readonly market: string;
  readonly interval: "1m";
  readonly openTime: number;
  readonly closeTime: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly source: "UPBIT_PUBLIC_CANDLE";
}

export interface ChartCandle extends Omit<PublicCandle, "interval"> {
  readonly interval: ChartInterval;
}

export interface ChartBar extends ChartCandle {
  readonly up: boolean;
  readonly bodyTop: number;
  readonly bodyHeight: number;
  readonly wickTop: number;
  readonly wickHeight: number;
}

export interface ChartViewModel {
  readonly state: ChartState;
  readonly market: string;
  readonly interval: ChartInterval;
  readonly error: string | null;
  readonly candles: readonly ChartCandle[];
  readonly bars: readonly ChartBar[];
  readonly currentPrice: number | null;
  readonly priceLine: number | null;
  readonly high: number | null;
  readonly low: number | null;
  readonly volume: number | null;
  /** Same fraction shape as WatchlistMarket.changeRate (watchlist.ts), e.g. 0.0234 = +2.34%. */
  readonly move: number | null;
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const finitePositive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const finiteNonNegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

function rawNumber(row: Record<string, unknown>, canonical: string, upbit: string): unknown {
  return row[canonical] ?? row[upbit];
}

function rawTimestamp(row: Record<string, unknown>): number {
  if (typeof row.openTime === "number") return row.openTime;
  if (typeof row.candle_date_time_utc === "string") return Date.parse(`${row.candle_date_time_utc.replace(/Z$/, "")}Z`);
  return Number.NaN;
}

/** Validate canonical bridge DTOs or the equivalent Upbit public candle payload. */
export function parsePublicCandles(raw: unknown, market: string): readonly PublicCandle[] {
  if (!Array.isArray(raw)) throw new Error("candle response is invalid");
  const expectedMarket = market.trim().toUpperCase();
  if (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(expectedMarket)) throw new Error("candle market is invalid");
  const parsed = raw.map((value, index) => {
    if (value === null || typeof value !== "object") throw new Error(`candle ${index} is invalid`);
    const row = value as Record<string, unknown>;
    const rowMarket = typeof row.market === "string" ? row.market : "";
    const openTime = rawTimestamp(row);
    const closeTime = typeof row.closeTime === "number" ? row.closeTime : openTime + ONE_MINUTE_MS;
    const open = rawNumber(row, "open", "opening_price");
    const high = rawNumber(row, "high", "high_price");
    const low = rawNumber(row, "low", "low_price");
    const close = rawNumber(row, "close", "trade_price");
    const volume = rawNumber(row, "volume", "candle_acc_trade_volume");
    const source = row.source ?? row.sourceType ?? "UPBIT_PUBLIC_CANDLE";
    if (rowMarket.trim().toUpperCase() !== expectedMarket || source !== "UPBIT_PUBLIC_CANDLE" || !Number.isSafeInteger(openTime) || openTime % ONE_MINUTE_MS !== 0 || !Number.isSafeInteger(closeTime) || closeTime - openTime !== ONE_MINUTE_MS) {
      throw new Error(`candle ${index} metadata is invalid`);
    }
    if (![open, high, low, close].every(finitePositive) || !finiteNonNegative(volume)) throw new Error(`candle ${index} OHLCV is invalid`);
    if ((low as number) > (high as number) || (open as number) < (low as number) || (open as number) > (high as number) || (close as number) < (low as number) || (close as number) > (high as number)) throw new Error(`candle ${index} violates OHLC bounds`);
    return freeze({ market: expectedMarket, interval: "1m" as const, openTime, closeTime, open: open as number, high: high as number, low: low as number, close: close as number, volume: volume as number, source: "UPBIT_PUBLIC_CANDLE" as const });
  });
  parsed.sort((left, right) => left.openTime - right.openTime);
  for (let index = 1; index < parsed.length; index += 1) {
    if (parsed[index]!.openTime === parsed[index - 1]!.openTime) throw new Error("candle timestamps are duplicated");
  }
  return freeze(parsed);
}

export function aggregatePublicCandles(candles: readonly PublicCandle[], interval: ChartInterval): readonly ChartCandle[] {
  const size = INTERVAL_MINUTES[interval];
  if (size === 1) return freeze(candles.map((candle) => freeze({ ...candle, interval })));
  const groups = new Map<number, PublicCandle[]>();
  for (const candle of candles) {
    const bucket = Math.floor(candle.openTime / (ONE_MINUTE_MS * size)) * ONE_MINUTE_MS * size;
    const group = groups.get(bucket) ?? [];
    group.push(candle);
    groups.set(bucket, group);
  }
  const result: ChartCandle[] = [];
  for (const [bucket, group] of [...groups.entries()].sort(([left], [right]) => left - right)) {
    if (group.length !== size || group[0]!.openTime !== bucket) continue;
    if (group.some((candle, index) => index > 0 && candle.openTime !== group[index - 1]!.closeTime)) continue;
    const first = group[0]!;
    const last = group[group.length - 1]!;
    result.push(freeze({ market: first.market, interval, openTime: first.openTime, closeTime: last.closeTime, open: first.open, high: Math.max(...group.map((candle) => candle.high)), low: Math.min(...group.map((candle) => candle.low)), close: last.close, volume: group.reduce((sum, candle) => sum + candle.volume, 0), source: "UPBIT_PUBLIC_CANDLE" }));
  }
  return freeze(result);
}

function chartBar(candle: ChartCandle, low: number, range: number): ChartBar {
  const scale = (price: number): number => ((low + range - price) / range) * 100;
  const bodyTop = Math.min(scale(candle.open), scale(candle.close));
  const bodyHeight = Math.max(2, Math.abs(scale(candle.open) - scale(candle.close)));
  return freeze({ ...candle, up: candle.close >= candle.open, bodyTop, bodyHeight, wickTop: scale(candle.high), wickHeight: Math.max(2, scale(candle.low) - scale(candle.high)) });
}

export function buildChartViewModel(input: { readonly market: string; readonly interval: ChartInterval; readonly rawCandles: unknown[] | null; readonly currentPrice: number | null; readonly connectionState: string; readonly stale: boolean; readonly changeRate?: number | null }): ChartViewModel {
  const empty = (state: ChartState, error: string | null, candles: readonly ChartCandle[] = []): ChartViewModel => freeze({ state, market: input.market, interval: input.interval, error, candles, bars: [], currentPrice: null, priceLine: null, high: null, low: null, volume: null, move: null });
  if (input.rawCandles === null) return empty("LOADING", null);
  if (input.connectionState !== "CONNECTED" && input.connectionState !== "HEALTHY" || input.stale) return empty("ERROR", "MARKET_DATA_NOT_READY");
  if (!finitePositive(input.currentPrice)) return empty("ERROR", "PRICE_NOT_RECEIVED");
  let base: readonly PublicCandle[];
  try { base = parsePublicCandles(input.rawCandles, input.market); } catch (error) { return empty("ERROR", error instanceof Error ? error.message : "CANDLE_DATA_INVALID"); }
  const candles = aggregatePublicCandles(base, input.interval);
  if (candles.length === 0) return empty("EMPTY", "NO_COMPLETE_CANDLES");
  const high = Math.max(...candles.map((candle) => candle.high));
  const low = Math.min(...candles.map((candle) => candle.low));
  const range = Math.max(high - low, Number.EPSILON);
  const bars = candles.map((candle) => chartBar(candle, low, range));
  const priceLine = Math.min(100, Math.max(0, ((high - input.currentPrice) / range) * 100));
  const move = typeof input.changeRate === "number" && Number.isFinite(input.changeRate) ? input.changeRate : null;
  return freeze({ state: "READY", market: input.market, interval: input.interval, error: null, candles, bars: freeze(bars), currentPrice: input.currentPrice, priceLine, high, low, volume: candles.reduce((sum, candle) => sum + candle.volume, 0), move });
}

export function formatChartPrice(value: number | null): string {
  return value === null ? "-" : `KRW ${Math.round(value).toLocaleString("en-US")}`;
}

/** Same fraction shape as WatchlistMarket.changeRate, e.g. 0.0234 = +2.34%. */
export function formatChartMove(value: number | null): string {
  return value === null ? "-" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

/**
 * Newest candle close across the plotted set, for first-class freshness
 * display. Defensive max (not last-element): grouping must never let an
 * out-of-order bucket hide the feed age. Null when nothing is verifiable.
 */
export function latestCandleCloseMs(candles: readonly ChartCandle[]): number | null {
  let latest: number | null = null;
  for (const candle of candles) {
    const closeTime = candle.closeTime;
    if (!Number.isSafeInteger(closeTime) || closeTime <= 0) continue;
    if (latest === null || closeTime > latest) latest = closeTime;
  }
  return latest;
}
