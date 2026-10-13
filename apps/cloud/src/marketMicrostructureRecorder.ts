import type { StoredOrderBookSample, StoredTradeTick } from "../../../packages/storage/src/marketMicrostructureStore";

/**
 * Records the public order book and trade ticks the runtime already receives on its existing Upbit WebSocket subscription,
 * into the research microstructure store. Upbit offers no history of either, so research on them needs data recorded from now
 * on (research ledger: TRADES and ORDERBOOK are the remaining untested data types).
 *
 * Research data only: it opens no connection, places no order, and feeds no PAPER, Risk, Governance or qualification decision.
 * Order books are sampled at most once per market per `sampleIntervalMs`; trades are buffered and written in batches. Every
 * failure is swallowed and counted, so recording can never stop or slow the trading runtime. Disabled with
 * NUSA_MICROSTRUCTURE_RECORDER=DISABLED.
 */
export interface MarketMicrostructureSink {
  readonly appendOrderBookSamples: (market: string, samples: readonly StoredOrderBookSample[]) => { readonly stored: number; readonly rejected: number };
  readonly appendTradeTicks: (market: string, ticks: readonly StoredTradeTick[]) => { readonly stored: number; readonly rejected: number };
  readonly summary: () => { readonly orderBookSamples: number; readonly tradeTicks: number; readonly firstAt?: number; readonly lastAt?: number };
}

export interface MicrostructureOrderBookInput {
  readonly code: string;
  readonly total_ask_size: number;
  readonly total_bid_size: number;
  readonly orderbook_units: readonly { readonly ask_price: number; readonly bid_price: number; readonly ask_size: number; readonly bid_size: number }[];
}

export interface MicrostructureTradeInput {
  readonly code: string;
  readonly trade_price: number;
  readonly trade_volume: number;
  readonly ask_bid: "ASK" | "BID";
  readonly trade_timestamp: number;
  readonly sequential_id?: number;
}

export interface MarketMicrostructureRecorderStatus {
  readonly orderBookSamples: number;
  readonly tradeTicks: number;
  readonly writeFailures: number;
  readonly lastRecordedAt?: number;
}

export function microstructureRecorderEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.NUSA_MICROSTRUCTURE_RECORDER === undefined || env.NUSA_MICROSTRUCTURE_RECORDER === "ENABLED";
}

export class MarketMicrostructureRecorder {
  private readonly lastSampleAt = new Map<string, number>();
  private readonly pendingTicks = new Map<string, StoredTradeTick[]>();
  private orderBookSamples = 0;
  private tradeTicks = 0;
  private writeFailures = 0;
  private lastRecordedAt: number | undefined;

  public constructor(
    private readonly sink: MarketMicrostructureSink,
    private readonly now: () => number = Date.now,
    private readonly sampleIntervalMs = 5_000,
    private readonly maximumPendingTicksPerMarket = 5_000,
  ) {
    try {
      const summary = sink.summary();
      this.orderBookSamples = summary.orderBookSamples;
      this.tradeTicks = summary.tradeTicks;
      this.lastRecordedAt = summary.lastAt;
    } catch { this.writeFailures += 1; }
  }

  public recordOrderBook(orderBook: MicrostructureOrderBookInput, receivedAt: number = this.now()): void {
    try {
      const market = orderBook.code.trim().toUpperCase();
      const last = this.lastSampleAt.get(market);
      if (last !== undefined && receivedAt - last < this.sampleIntervalMs) return;
      const units = orderBook.orderbook_units;
      if (units.length === 0) return;
      const top = units.slice(0, 5);
      const sample: StoredOrderBookSample = {
        capturedAtMs: receivedAt,
        bestBid: units[0]!.bid_price,
        bestAsk: units[0]!.ask_price,
        bidSize5: top.reduce((sum, unit) => sum + unit.bid_size, 0),
        askSize5: top.reduce((sum, unit) => sum + unit.ask_size, 0),
        totalBidSize: orderBook.total_bid_size,
        totalAskSize: orderBook.total_ask_size,
      };
      this.lastSampleAt.set(market, receivedAt);
      const result = this.sink.appendOrderBookSamples(market, [sample]);
      this.orderBookSamples += result.stored;
      if (result.stored > 0) this.lastRecordedAt = receivedAt;
    } catch { this.writeFailures += 1; }
  }

  /** Buffers a trade tick; a tick without a sequential id cannot be deduplicated and is not recorded. */
  public recordTrade(trade: MicrostructureTradeInput): void {
    try {
      if (trade.sequential_id === undefined) return;
      const market = trade.code.trim().toUpperCase();
      const pending = this.pendingTicks.get(market) ?? [];
      if (pending.length >= this.maximumPendingTicksPerMarket) return;
      pending.push({ sequentialId: trade.sequential_id, tradedAtMs: trade.trade_timestamp, price: trade.trade_price, volume: trade.trade_volume, side: trade.ask_bid });
      this.pendingTicks.set(market, pending);
    } catch { this.writeFailures += 1; }
  }

  /** Writes buffered ticks. Called on a timer; never throws. */
  public flush(): void {
    for (const [market, ticks] of [...this.pendingTicks.entries()]) {
      this.pendingTicks.delete(market);
      if (ticks.length === 0) continue;
      try {
        const result = this.sink.appendTradeTicks(market, ticks);
        this.tradeTicks += result.stored;
        if (result.stored > 0) this.lastRecordedAt = this.now();
      } catch { this.writeFailures += 1; }
    }
  }

  public status(): MarketMicrostructureRecorderStatus {
    return Object.freeze({ orderBookSamples: this.orderBookSamples, tradeTicks: this.tradeTicks, writeFailures: this.writeFailures, ...(this.lastRecordedAt === undefined ? {} : { lastRecordedAt: this.lastRecordedAt }) });
  }
}
