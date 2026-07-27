export type OperationalCandleQuality = "VALID" | "INCOMPLETE" | "GAP_DETECTED" | "OUT_OF_ORDER" | "RECONNECT_INVALIDATED" | "STALE_SOURCE";

export interface OperationalCandle {
  readonly symbol: string;
  readonly interval: "1m";
  readonly openTime: number;
  readonly closeTime: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly sourceType: "UPBIT_PUBLIC_CANDLE";
  readonly sourceEventCount: number;
  readonly firstSourceTimestamp: number;
  readonly lastSourceTimestamp: number;
  readonly closeConfirmed: boolean;
  readonly duplicateCount: number;
  readonly outOfOrderCount: number;
  readonly gapDetected: boolean;
  readonly reconnectBoundary: boolean;
  readonly incomplete: boolean;
  readonly qualityStatus: OperationalCandleQuality;
  readonly candleId: string;
}

export interface UpbitMinuteCandleResponse {
  readonly market: string;
  readonly candle_date_time_utc: string;
  readonly opening_price: number;
  readonly high_price: number;
  readonly low_price: number;
  readonly trade_price: number;
  readonly candle_acc_trade_volume: number;
}

export type PublicCandleRequest = (url: string) => Promise<unknown>;

export class UpbitMinuteCandleSourceError extends Error {
  constructor(readonly code: "REQUEST_FAILED" | "INVALID_RESPONSE" | "NO_CLOSED_CANDLES" | "GAP_DETECTED" | "OUT_OF_ORDER", message: string) {
    super(message);
    this.name = "UpbitMinuteCandleSourceError";
  }
}

const ONE_MINUTE_MS = 60_000;
const defaultRequest: PublicCandleRequest = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};

function parseOpenTime(value: unknown): number {
  if (typeof value !== "string") throw new UpbitMinuteCandleSourceError("INVALID_RESPONSE", "candle timestamp is invalid");
  const timestamp = Date.parse(value.endsWith("Z") ? value : `${value}Z`);
  if (!Number.isSafeInteger(timestamp)) throw new UpbitMinuteCandleSourceError("INVALID_RESPONSE", "candle timestamp is invalid");
  return timestamp;
}

function parseResponse(value: unknown, symbol: string, now: number): OperationalCandle[] {
  if (!Array.isArray(value)) throw new UpbitMinuteCandleSourceError("INVALID_RESPONSE", "Upbit candle response is not an array");
  return value.map((item, index) => {
    if (item == null || typeof item !== "object") throw new UpbitMinuteCandleSourceError("INVALID_RESPONSE", `candle ${index} is invalid`);
    const candle = item as Partial<UpbitMinuteCandleResponse>;
    if (candle.market !== symbol) throw new UpbitMinuteCandleSourceError("INVALID_RESPONSE", `candle ${index} has the wrong market`);
    const openTime = parseOpenTime(candle.candle_date_time_utc);
    const values = [candle.opening_price, candle.high_price, candle.low_price, candle.trade_price, candle.candle_acc_trade_volume];
    if (!values.every((value) => typeof value === "number" && Number.isFinite(value)) ||
      candle.opening_price! <= 0 || candle.high_price! <= 0 || candle.low_price! <= 0 || candle.trade_price! <= 0 || candle.candle_acc_trade_volume! < 0 ||
      candle.low_price! > candle.high_price! || candle.opening_price! < candle.low_price! || candle.opening_price! > candle.high_price! ||
      candle.trade_price! < candle.low_price! || candle.trade_price! > candle.high_price!) {
      throw new UpbitMinuteCandleSourceError("INVALID_RESPONSE", `candle ${index} violates OHLCV invariants`);
    }
    const closeTime = openTime + ONE_MINUTE_MS;
    const closed = closeTime <= now;
    return Object.freeze({
      symbol,
      interval: "1m" as const,
      openTime,
      closeTime,
      open: candle.opening_price!,
      high: candle.high_price!,
      low: candle.low_price!,
      close: candle.trade_price!,
      volume: candle.candle_acc_trade_volume!,
      sourceType: "UPBIT_PUBLIC_CANDLE" as const,
      sourceEventCount: 1,
      firstSourceTimestamp: openTime,
      lastSourceTimestamp: openTime,
      closeConfirmed: closed,
      duplicateCount: 0,
      outOfOrderCount: 0,
      gapDetected: false,
      reconnectBoundary: false,
      incomplete: !closed,
      qualityStatus: closed ? "VALID" as const : "INCOMPLETE" as const,
      candleId: `${symbol}:1m:${openTime}`
    });
  }).filter((candle) => candle.closeConfirmed);
}

export class UpbitMinuteCandleSource {
  constructor(
    private readonly symbol: string,
    private readonly request: PublicCandleRequest = defaultRequest,
    private readonly clock: () => number = Date.now
  ) {
    if (!symbol.trim()) throw new Error("candle source symbol is required");
  }

  async loadClosedCandles(count = 200): Promise<readonly OperationalCandle[]> {
    if (!Number.isSafeInteger(count) || count < 1 || count > 200) throw new Error("candle count must be between 1 and 200");
    let raw: unknown;
    try {
      raw = await this.request(`https://api.upbit.com/v1/candles/minutes/1?market=${encodeURIComponent(this.symbol)}&count=${count}`);
    } catch (error) {
      throw new UpbitMinuteCandleSourceError("REQUEST_FAILED", error instanceof Error ? error.message : String(error));
    }
    const parsed = parseResponse(raw, this.symbol, this.clock());
    const ascending = parsed.every((candle, index) => index === 0 || candle.openTime > parsed[index - 1]!.openTime);
    const descending = parsed.every((candle, index) => index === 0 || candle.openTime < parsed[index - 1]!.openTime);
    if (!ascending && !descending) throw new UpbitMinuteCandleSourceError("OUT_OF_ORDER", "candle timestamps are not strictly ordered");
    const candles = [...parsed].sort((left, right) => left.openTime - right.openTime);
    if (candles.length === 0) throw new UpbitMinuteCandleSourceError("NO_CLOSED_CANDLES", "Upbit returned no closed candles");
    for (let index = 1; index < candles.length; index += 1) {
      if (candles[index]!.openTime <= candles[index - 1]!.openTime) throw new UpbitMinuteCandleSourceError("OUT_OF_ORDER", "candle timestamps are not strictly increasing");
      if (candles[index]!.openTime !== candles[index - 1]!.openTime + ONE_MINUTE_MS) throw new UpbitMinuteCandleSourceError("GAP_DETECTED", "Upbit candle response contains a missing interval");
    }
    return Object.freeze(candles);
  }
}
