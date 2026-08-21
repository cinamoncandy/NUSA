export interface OperationalCandle {
  readonly symbol: string; readonly interval: "1m"; readonly openTime: number; readonly closeTime: number;
  readonly open: number; readonly high: number; readonly low: number; readonly close: number; readonly volume: number;
  readonly sourceType: "UPBIT_PUBLIC_CANDLE"; readonly closeConfirmed: true; readonly qualityStatus: "VALID"; readonly candleId: string;
}

export type PublicCandleRequest = (url: string) => Promise<unknown>;
export class UpbitMinuteCandleSourceError extends Error { constructor(readonly code: "REQUEST_FAILED" | "INVALID_RESPONSE" | "NO_CLOSED_CANDLES" | "GAP_DETECTED" | "OUT_OF_ORDER", message: string) { super(message); this.name = "UpbitMinuteCandleSourceError"; } }
const minute = 60_000;
const request: PublicCandleRequest = async (url) => { const response = await fetch(url); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); };

function parse(value: unknown, symbol: string, now: number): OperationalCandle[] {
  if (!Array.isArray(value)) throw new UpbitMinuteCandleSourceError("INVALID_RESPONSE", "candle response is not an array");
  const mapped: Array<OperationalCandle | undefined> = value.map((item, index) => {
    if (item == null || typeof item !== "object") throw new UpbitMinuteCandleSourceError("INVALID_RESPONSE", `candle ${index} is invalid`);
    const row = item as Record<string, unknown>;
    const openTime = typeof row.candle_date_time_utc === "string" ? Date.parse(`${row.candle_date_time_utc.replace(/Z$/, "")}Z`) : NaN;
    const values = [row.opening_price, row.high_price, row.low_price, row.trade_price, row.candle_acc_trade_volume];
    if (row.market !== symbol || !Number.isSafeInteger(openTime) || !values.every((value) => typeof value === "number" && Number.isFinite(value))) throw new UpbitMinuteCandleSourceError("INVALID_RESPONSE", `candle ${index} is invalid`);
    const [open, high, low, close, volume] = values as number[];
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0 || low > high || open < low || open > high || close < low || close > high) throw new UpbitMinuteCandleSourceError("INVALID_RESPONSE", `candle ${index} violates OHLCV invariants`);
    const closeTime = openTime + minute;
    if (closeTime > now) return undefined;
    return Object.freeze({ symbol, interval: "1m" as const, openTime, closeTime, open, high, low, close, volume, sourceType: "UPBIT_PUBLIC_CANDLE" as const, closeConfirmed: true as const, qualityStatus: "VALID" as const, candleId: `${symbol}:1m:${openTime}` }) as OperationalCandle;
  });
  return mapped.filter((candle): candle is OperationalCandle => candle !== undefined);
}

export class UpbitMinuteCandleSource {
  constructor(private readonly symbol: string, private readonly fetcher: PublicCandleRequest = request, private readonly clock: () => number = Date.now) { if (!symbol.trim()) throw new Error("candle source symbol is required"); }
  async loadClosedCandles(count = 200): Promise<readonly OperationalCandle[]> {
    if (!Number.isSafeInteger(count) || count < 1 || count > 200) throw new Error("candle count must be between 1 and 200");
    let raw: unknown; try { raw = await this.fetcher(`https://api.upbit.com/v1/candles/minutes/1?market=${encodeURIComponent(this.symbol)}&count=${count}`); } catch (error) { throw new UpbitMinuteCandleSourceError("REQUEST_FAILED", error instanceof Error ? error.message : String(error)); }
    const parsed = parse(raw, this.symbol, this.clock());
    const ascending = parsed.every((candle, index) => index === 0 || candle.openTime > parsed[index - 1]!.openTime);
    const descending = parsed.every((candle, index) => index === 0 || candle.openTime < parsed[index - 1]!.openTime);
    if (!ascending && !descending) throw new UpbitMinuteCandleSourceError("OUT_OF_ORDER", "candle timestamps are not strictly ordered");
    const candles = [...parsed].sort((left, right) => left.openTime - right.openTime);
    for (let index = 1; index < candles.length; index += 1) if (candles[index]!.openTime !== candles[index - 1]!.openTime + minute) throw new UpbitMinuteCandleSourceError("GAP_DETECTED", "candle response contains a missing interval");
    if (candles.length === 0) throw new UpbitMinuteCandleSourceError("NO_CLOSED_CANDLES", "no closed candles available");
    return Object.freeze(candles);
  }
}
