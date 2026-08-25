/**
 * Pure public-ticker aggregation for the future Shadow runtime. This module does
 * not connect to a network, call a strategy, or know about PaperBroker.
 */
export interface PublicTickerSample {
  readonly code: string;
  readonly trade_price: number;
  readonly trade_timestamp: number;
  readonly trade_volume?: number;
  readonly trade_id?: string;
}

export interface ClosedCandle {
  readonly symbol: string;
  readonly interval: "1m";
  readonly openTime: number;
  readonly closeTime: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly volumeAvailable: boolean;
  readonly tradeCount: number;
  readonly closed: true;
  readonly sequence: number;
  readonly source: "UPBIT_PUBLIC_TICKER" | "UPBIT_PUBLIC_CANDLE";
}

export type ClosedCandleHealthCode = "DISCONNECTED" | "RECONNECTED" | "INVALID_TICKER" | "SYMBOL_MISMATCH" | "DUPLICATE_TICKER" | "OUT_OF_ORDER" | "GAP_DETECTED";
export interface ClosedCandleHealthEvent { readonly code: ClosedCandleHealthCode; readonly timestamp?: number; readonly missingIntervals?: number; }
export interface ClosedCandleAdapterState { readonly connected: boolean; readonly currentBucket: number | null; readonly closedCandleCount: number; readonly requiredWarmupCandles: number; readonly warmupComplete: boolean; }
export interface ClosedCandleIngestResult { readonly emittedCandles: readonly ClosedCandle[]; readonly healthEvents: readonly ClosedCandleHealthEvent[]; readonly currentBucket: number | null; readonly closedCandleCount: number; readonly warmupComplete: boolean; }

interface OpenCandle {
  readonly bucket: number;
  readonly open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  volumeAvailable: boolean;
  tradeCount: number;
  lastTimestamp: number;
  lastKey: string;
  readonly seen: Set<string>;
}

const ONE_MINUTE_MS = 60_000;
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function tickerKey(ticker: PublicTickerSample): string {
  return ticker.trade_id ?? `${ticker.code}|${ticker.trade_timestamp}|${ticker.trade_price}|${ticker.trade_volume ?? "unavailable"}`;
}

function validTicker(ticker: unknown): ticker is PublicTickerSample {
  if (typeof ticker !== "object" || ticker === null) return false;
  const candidate = ticker as Partial<PublicTickerSample>;
  return typeof candidate.code === "string" && candidate.code.length > 0
    && Number.isFinite(candidate.trade_price) && (candidate.trade_price as number) > 0
    && Number.isSafeInteger(candidate.trade_timestamp) && (candidate.trade_timestamp as number) >= 0
    && (candidate.trade_volume === undefined || Number.isFinite(candidate.trade_volume) && candidate.trade_volume >= 0);
}

function maybeTimestamp(ticker: unknown): number | undefined {
  if (typeof ticker !== "object" || ticker === null) return undefined;
  const timestamp = (ticker as Partial<PublicTickerSample>).trade_timestamp;
  return typeof timestamp === "number" ? timestamp : undefined;
}

export class ClosedCandleAdapter {
  private open?: OpenCandle;
  private connected = true;
  private closedCandleCount = 0;
  private sequence = 0;

  constructor(private readonly configuration: Readonly<{ symbol: string; intervalMs: number; requiredWarmupCandles: number }>) {
    if (!configuration.symbol || configuration.intervalMs !== ONE_MINUTE_MS || !Number.isSafeInteger(configuration.requiredWarmupCandles) || configuration.requiredWarmupCandles < 1) throw new Error("invalid closed candle adapter configuration");
  }

  ingestTicker(ticker: PublicTickerSample): ClosedCandleIngestResult {
    const events: ClosedCandleHealthEvent[] = [];
    if (!this.connected) return this.result([], [freeze({ code: "DISCONNECTED", timestamp: maybeTimestamp(ticker) })]);
    if (!validTicker(ticker)) return this.result([], [freeze({ code: "INVALID_TICKER", timestamp: maybeTimestamp(ticker) })]);
    if (ticker.code !== this.configuration.symbol) return this.result([], [freeze({ code: "SYMBOL_MISMATCH", timestamp: ticker.trade_timestamp })]);
    const bucket = Math.floor(ticker.trade_timestamp / this.configuration.intervalMs) * this.configuration.intervalMs;
    const key = tickerKey(ticker);
    if (!this.open) { this.open = this.createOpen(bucket, ticker, key); return this.result([], events); }
    if (bucket < this.open.bucket || bucket === this.open.bucket && (ticker.trade_timestamp < this.open.lastTimestamp || ticker.trade_timestamp === this.open.lastTimestamp && key < this.open.lastKey)) return this.result([], [freeze({ code: "OUT_OF_ORDER", timestamp: ticker.trade_timestamp })]);
    if (bucket === this.open.bucket) {
      if (this.open.seen.has(key)) return this.result([], [freeze({ code: "DUPLICATE_TICKER", timestamp: ticker.trade_timestamp })]);
      this.apply(this.open, ticker, key);
      return this.result([], events);
    }
    const emitted = this.close(this.open);
    if (bucket > this.open.bucket + this.configuration.intervalMs) events.push(freeze({ code: "GAP_DETECTED", timestamp: ticker.trade_timestamp, missingIntervals: (bucket - this.open.bucket) / this.configuration.intervalMs - 1 }));
    this.open = this.createOpen(bucket, ticker, key);
    return this.result([emitted], events);
  }

  markDisconnected(timestamp?: number): ClosedCandleHealthEvent { this.connected = false; return freeze({ code: "DISCONNECTED", ...(timestamp === undefined ? {} : { timestamp }) }); }
  /**
   * Throws away the minute currently being assembled (WO-0034-A4L).
   *
   * Called when the feed drops, because ticks from before an outage and ticks from after it
   * do not describe one minute of trading. Left in place, that half-built candle keeps
   * accumulating on reconnection and closes as a normal candle spanning the gap -- and if the
   * outage was shorter than one interval, no GAP_DETECTED is raised to say so. Kept separate
   * from `markDisconnected` so a caller that only wants to stop ingestion still can.
   */
  dropOpenCandle(): void { this.open = undefined; }
  markReconnected(timestamp?: number): ClosedCandleHealthEvent { this.connected = true; return freeze({ code: "RECONNECTED", ...(timestamp === undefined ? {} : { timestamp }) }); }
  resetWarmup(): void { this.closedCandleCount = 0; }
  inspectState(): ClosedCandleAdapterState { return freeze({ connected: this.connected, currentBucket: this.open?.bucket ?? null, closedCandleCount: this.closedCandleCount, requiredWarmupCandles: this.configuration.requiredWarmupCandles, warmupComplete: this.closedCandleCount >= this.configuration.requiredWarmupCandles }); }

  private createOpen(bucket: number, ticker: PublicTickerSample, key: string): OpenCandle {
    return { bucket, open: ticker.trade_price, high: ticker.trade_price, low: ticker.trade_price, close: ticker.trade_price, volume: ticker.trade_volume ?? 0, volumeAvailable: ticker.trade_volume !== undefined, tradeCount: 1, lastTimestamp: ticker.trade_timestamp, lastKey: key, seen: new Set([key]) };
  }
  private apply(candle: OpenCandle, ticker: PublicTickerSample, key: string): void {
    candle.high = Math.max(candle.high, ticker.trade_price); candle.low = Math.min(candle.low, ticker.trade_price); candle.close = ticker.trade_price; candle.tradeCount += 1; candle.lastTimestamp = ticker.trade_timestamp; candle.lastKey = key; candle.seen.add(key);
    if (ticker.trade_volume === undefined) candle.volumeAvailable = false; else candle.volume += ticker.trade_volume;
  }
  private close(candle: OpenCandle): ClosedCandle {
    this.closedCandleCount += 1;
    return freeze({ symbol: this.configuration.symbol, interval: "1m", openTime: candle.bucket, closeTime: candle.bucket + this.configuration.intervalMs, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volumeAvailable ? candle.volume : 0, volumeAvailable: candle.volumeAvailable, tradeCount: candle.tradeCount, closed: true, sequence: ++this.sequence, source: "UPBIT_PUBLIC_TICKER" });
  }
  private result(emittedCandles: readonly ClosedCandle[], healthEvents: readonly ClosedCandleHealthEvent[]): ClosedCandleIngestResult { const state = this.inspectState(); return freeze({ emittedCandles: freeze([...emittedCandles]), healthEvents: freeze([...healthEvents]), currentBucket: state.currentBucket, closedCandleCount: state.closedCandleCount, warmupComplete: state.warmupComplete }); }
}

export function createClosedCandleAdapter(configuration: Readonly<{ symbol: string; intervalMs?: number; requiredWarmupCandles?: number }>): ClosedCandleAdapter {
  return new ClosedCandleAdapter({ symbol: configuration.symbol, intervalMs: configuration.intervalMs ?? ONE_MINUTE_MS, requiredWarmupCandles: configuration.requiredWarmupCandles ?? 20 });
}
