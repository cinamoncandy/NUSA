/**
 * Live market data for the web server, via Upbit's public REST candle endpoint
 * (https://docs.upbit.com, no API key required) rather than the WebSocket ticker
 * apps/desktop/src/upbitWebSocket.ts uses. This repo previously had zero live/minute
 * candle fetching anywhere (only a daily-candle mapper for offline research, and a
 * tick-level WebSocket client) -- addresses the "캔들 데이터 없음" gap for a web-served
 * chart, and doubles as this server's current-price feed so it does not need the "ws"
 * package at all.
 *
 * Trade-off, stated plainly: signals are generated once per poll (default every
 * pollIntervalMs), not per real trade tick like the WebSocket-driven desktop app. This is
 * real Upbit data at a coarser cadence, not simulated/invented data.
 */

export interface UpbitMinuteCandle {
  readonly market: string;
  readonly candle_date_time_utc: string;
  readonly opening_price: number;
  readonly high_price: number;
  readonly low_price: number;
  readonly trade_price: number;
  readonly candle_acc_trade_volume: number;
  readonly unit: number;
}

export interface ChartCandle {
  readonly market: string;
  readonly unitMinutes: number;
  readonly openTime: number;
  readonly closeTime: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/**
 * Converts Upbit's public minute-candle response into ChartCandle records. Pure and
 * network-free, mirroring apps/desktop/src/upbitCandleAdapter.ts's mapping conventions
 * (ascending by openTime; Upbit itself returns most-recent-first).
 */
export function mapUpbitMinuteCandlesToChartCandles(raw: readonly UpbitMinuteCandle[], unitMinutes: number): readonly ChartCandle[] {
  if (raw.length === 0) throw new Error("upbit candle response is empty");
  if (!Number.isInteger(unitMinutes) || unitMinutes <= 0) throw new Error("unitMinutes must be a positive integer");
  const closeMs = unitMinutes * 60_000;
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
      unitMinutes,
      openTime,
      closeTime: openTime + closeMs,
      open: candle.opening_price,
      high: candle.high_price,
      low: candle.low_price,
      close: candle.trade_price,
      volume: candle.candle_acc_trade_volume
    });
  });
  return Object.freeze([...mapped].sort((left, right) => left.openTime - right.openTime));
}

/** Fetches raw minute candles from Upbit's public REST API. Network I/O lives only here. */
export async function fetchRecentMinuteCandles(market: string, unitMinutes: number, count: number): Promise<readonly UpbitMinuteCandle[]> {
  const url = `https://api.upbit.com/v1/candles/minutes/${unitMinutes}?market=${encodeURIComponent(market)}&count=${count}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Upbit request failed: HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body) || body.length === 0) throw new Error("Upbit returned no candles");
  return body as readonly UpbitMinuteCandle[];
}

export type LiveCandleFeedStatus = "CONNECTING" | "CONNECTED" | "ERROR";
export interface LiveCandleFeedHealth {
  readonly status: LiveCandleFeedStatus;
  readonly lastUpdatedAt?: number;
  readonly lastError?: string;
}

type CandleFetcher = (market: string, unitMinutes: number, count: number) => Promise<readonly UpbitMinuteCandle[]>;

/**
 * Polls Upbit's public minute-candle endpoint on an interval and notifies a callback with
 * the latest candle set on every successful poll. Failures never clear previously-fetched
 * candles (stale-but-real data is safer to keep visible than a blank chart); health()
 * reports ERROR so callers (e.g. the strategy/price feed) can decide to pause automatic
 * signals on stale data, the same way apps/desktop's UpbitWebSocketClient status drives
 * disableAutomaticTradingForMarketFault in apps/desktop/src/main.ts.
 */
export class LiveCandleFeed {
  private timer: ReturnType<typeof setInterval> | undefined;
  private candles: readonly ChartCandle[] = [];
  private status: LiveCandleFeedStatus = "CONNECTING";
  private lastUpdatedAt: number | undefined;
  private lastError: string | undefined;
  private polling = false;

  constructor(
    private readonly market: string,
    private readonly unitMinutes: number,
    private readonly count: number,
    private readonly onUpdate: (candles: readonly ChartCandle[]) => void,
    private readonly pollIntervalMs = 10_000,
    private readonly fetcher: CandleFetcher = fetchRecentMinuteCandles
  ) {
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) throw new Error("pollIntervalMs must be positive");
  }

  async pollOnce(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const raw = await this.fetcher(this.market, this.unitMinutes, this.count);
      this.candles = mapUpbitMinuteCandlesToChartCandles(raw, this.unitMinutes);
      this.status = "CONNECTED";
      this.lastUpdatedAt = Date.now();
      this.lastError = undefined;
      this.onUpdate(this.candles);
    } catch (error) {
      this.status = "ERROR";
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      this.polling = false;
    }
  }

  start(): void {
    if (this.timer) return;
    void this.pollOnce();
    this.timer = setInterval(() => { void this.pollOnce(); }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  health(): LiveCandleFeedHealth {
    return Object.freeze({
      status: this.status,
      ...(this.lastUpdatedAt === undefined ? {} : { lastUpdatedAt: this.lastUpdatedAt }),
      ...(this.lastError === undefined ? {} : { lastError: this.lastError })
    });
  }

  latestCandles(): readonly ChartCandle[] { return this.candles; }
}
