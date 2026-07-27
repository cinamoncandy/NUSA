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

/** Fields common to every Upbit public candle endpoint (minutes/days/weeks/months) --
 * mapUpbitMinuteCandlesToChartCandles() only ever reads these, so day candles (which omit
 * `unit`) are just as valid an input as minute candles. */
export interface UpbitCandle {
  readonly market: string;
  readonly candle_date_time_utc: string;
  readonly opening_price: number;
  readonly high_price: number;
  readonly low_price: number;
  readonly trade_price: number;
  readonly candle_acc_trade_volume: number;
}

export interface UpbitMinuteCandle extends UpbitCandle {
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
export function mapUpbitMinuteCandlesToChartCandles(raw: readonly UpbitCandle[], unitMinutes: number): readonly ChartCandle[] {
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

/** Upbit's own per-request cap on every public candle endpoint. */
const MAX_CANDLES_PER_PAGE = 200;

/** Hard safety cap on how many pages fetchRecentMinuteCandles will ever issue for one call,
 * regardless of the requested count -- bounds worst-case request volume against Upbit's
 * public API (a caller cannot accidentally trigger hundreds of sequential requests). */
const MAX_MINUTE_CANDLE_PAGES = 10;

async function fetchMinuteCandlePage(market: string, unitMinutes: number, count: number, to?: string): Promise<readonly UpbitMinuteCandle[]> {
  const toParam = to === undefined ? "" : `&to=${encodeURIComponent(to)}`;
  const url = `https://api.upbit.com/v1/candles/minutes/${unitMinutes}?market=${encodeURIComponent(market)}&count=${count}${toParam}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Upbit request failed: HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body) || body.length === 0) throw new Error("Upbit returned no candles");
  return body as readonly UpbitMinuteCandle[];
}

/**
 * Fetches raw minute candles from Upbit's public REST API. Network I/O lives only here.
 * Upbit caps a single request at MAX_CANDLES_PER_PAGE (200) candles; a `count` beyond that
 * pages backward via the `to` cursor param (each page's oldest candle's open time, minus one
 * unit, becomes the next page's `to`), up to MAX_MINUTE_CANDLE_PAGES pages. This only engages
 * for the on-demand backtest's minute-unit timeframe (paperRuntime.ts requests more than 200
 * there -- 200 minutes alone is too thin a window for a crossover strategy backtest to mean
 * much); the live poll/chart path (LiveCandleFeed) always requests <= 200 and never pages.
 */
export async function fetchRecentMinuteCandles(market: string, unitMinutes: number, count: number): Promise<readonly UpbitMinuteCandle[]> {
  if (count <= MAX_CANDLES_PER_PAGE) return fetchMinuteCandlePage(market, unitMinutes, count);
  const pages: UpbitMinuteCandle[][] = [];
  let remaining = count;
  let cursor: string | undefined;
  for (let page = 0; page < MAX_MINUTE_CANDLE_PAGES && remaining > 0; page++) {
    const pageCount = Math.min(remaining, MAX_CANDLES_PER_PAGE);
    const candles = await fetchMinuteCandlePage(market, unitMinutes, pageCount, cursor);
    pages.push(candles as UpbitMinuteCandle[]);
    remaining -= candles.length;
    if (candles.length < pageCount) break;
    const oldest = candles[candles.length - 1]!;
    const oldestOpenTime = Date.parse(`${oldest.candle_date_time_utc}Z`);
    cursor = new Date(oldestOpenTime - unitMinutes * 60_000).toISOString().slice(0, 19);
  }
  return Object.freeze(pages.flat());
}

/**
 * Fetches raw day candles from Upbit's public REST API (/v1/candles/days) -- same per-request
 * count cap (200) as minute candles, but 200 *days* is a far more meaningful window for a
 * SMA/EMA crossover strategy than 200 minutes (~3.3 hours). Used only for the on-demand
 * backtest comparison (paperRuntime.ts's runBacktestComparison), as an alternative timeframe
 * to the default 1-minute candles -- never for live polling/charting, which stays minute-based.
 */
export async function fetchRecentDayCandles(market: string, count: number): Promise<readonly UpbitCandle[]> {
  const url = `https://api.upbit.com/v1/candles/days?market=${encodeURIComponent(market)}&count=${count}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Upbit request failed: HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body) || body.length === 0) throw new Error("Upbit returned no candles");
  return body as readonly UpbitCandle[];
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
