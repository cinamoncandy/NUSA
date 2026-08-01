export interface OperationalCandle {
  readonly symbol: string; readonly interval: "1m"; readonly openTime: number; readonly closeTime: number;
  readonly open: number; readonly high: number; readonly low: number; readonly close: number; readonly volume: number;
  readonly sourceType: "UPBIT_PUBLIC_CANDLE"; readonly closeConfirmed: true; readonly qualityStatus: "VALID"; readonly candleId: string;
}

export type PublicCandleRequest = (url: string) => Promise<unknown>;
export class UpbitMinuteCandleSourceError extends Error { constructor(readonly code: "REQUEST_FAILED" | "INVALID_RESPONSE" | "NO_CLOSED_CANDLES" | "GAP_DETECTED" | "OUT_OF_ORDER", message: string) { super(message); this.name = "UpbitMinuteCandleSourceError"; } }
const minute = 60_000;
const request: PublicCandleRequest = async (url) => { const response = await fetch(url); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); };
const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface UpbitMinuteCandleSourceOptions {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly minimumIntervalMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const retryable = (error: unknown): boolean => /(?:HTTP\s+(?:429|5\d\d)|fetch|network|timeout|timed out|connection|socket|ECONNRESET)/i.test(error instanceof Error ? error.message : String(error));

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
  private lastRequestAt?: number;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly minimumIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly symbol: string, private readonly fetcher: PublicCandleRequest = request, private readonly clock: () => number = Date.now, options: UpbitMinuteCandleSourceOptions = {}) {
    if (!symbol.trim()) throw new Error("candle source symbol is required");
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 250;
    this.maxDelayMs = options.maxDelayMs ?? 2_000;
    this.minimumIntervalMs = options.minimumIntervalMs ?? 100;
    this.sleep = options.sleep ?? defaultSleep;
    if (!Number.isSafeInteger(this.maxAttempts) || this.maxAttempts < 1 || !Number.isSafeInteger(this.baseDelayMs) || this.baseDelayMs < 0 || !Number.isSafeInteger(this.maxDelayMs) || this.maxDelayMs < this.baseDelayMs || !Number.isSafeInteger(this.minimumIntervalMs) || this.minimumIntervalMs < 0) throw new Error("invalid public candle request policy");
  }
  async loadClosedCandles(count = 200): Promise<readonly OperationalCandle[]> {
    if (!Number.isSafeInteger(count) || count < 1 || count > 200) throw new Error("candle count must be between 1 and 200");
    const url = `https://api.upbit.com/v1/candles/minutes/1?market=${encodeURIComponent(this.symbol)}&count=${count}`;
    let raw: unknown;
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const now = this.clock();
        const wait = this.lastRequestAt == null ? 0 : Math.max(0, this.minimumIntervalMs - (now - this.lastRequestAt));
        if (wait > 0) await this.sleep(wait);
        this.lastRequestAt = this.clock();
        raw = await this.fetcher(url);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (!retryable(error) || attempt === this.maxAttempts) break;
        await this.sleep(Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (attempt - 1)));
      }
    }
    if (lastError !== undefined) throw new UpbitMinuteCandleSourceError("REQUEST_FAILED", lastError instanceof Error ? lastError.message : String(lastError));
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
