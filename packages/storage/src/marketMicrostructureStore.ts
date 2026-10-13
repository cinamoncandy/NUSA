import type { SqliteDatabase } from "./index";

const MARKET = /^KRW-[A-Z0-9-]+$/;

/**
 * Durable research store of public Upbit market microstructure: sampled order-book tops and trade ticks. It exists because
 * Upbit offers no history of either, so a research question about them can only be answered from data recorded from now on
 * (docs/research-ledger: TRADES and ORDERBOOK were the remaining untested data types). Rows are public market data only (no
 * account, order or fill). Appends are idempotent per key, and retention is bounded per market.
 */
export interface StoredOrderBookSample {
  readonly capturedAtMs: number;
  readonly bestBid: number;
  readonly bestAsk: number;
  /** Summed size of the top five bid / ask levels. */
  readonly bidSize5: number;
  readonly askSize5: number;
  readonly totalBidSize: number;
  readonly totalAskSize: number;
}

/**
 * A trade tick is identified by its content (time, price, volume, side). Upbit's sequential_id (~1.79e16) is above
 * Number.MAX_SAFE_INTEGER and arrives already rounded by JSON.parse, so it cannot identify a trade (migration 029; the 028
 * table keyed by it never stored a row). Two identical trades in the same millisecond collapse into one row.
 */
export interface StoredTradeTick {
  readonly tradedAtMs: number;
  readonly price: number;
  readonly volume: number;
  readonly side: "ASK" | "BID";
}

export class MarketMicrostructureStoreError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "MarketMicrostructureStoreError";
  }
}

const positive = (value: number): boolean => Number.isFinite(value) && value > 0;
const nonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;

function checkMarket(market: string): void {
  if (typeof market !== "string" || !MARKET.test(market)) throw new MarketMicrostructureStoreError("INVALID_MARKET", "microstructure market is invalid");
}

function validSample(sample: StoredOrderBookSample): boolean {
  return Number.isSafeInteger(sample.capturedAtMs) && sample.capturedAtMs > 0 && positive(sample.bestBid) && positive(sample.bestAsk) && sample.bestBid <= sample.bestAsk
    && [sample.bidSize5, sample.askSize5, sample.totalBidSize, sample.totalAskSize].every(nonNegative);
}

function validTick(tick: StoredTradeTick): boolean {
  return Number.isSafeInteger(tick.tradedAtMs) && tick.tradedAtMs > 0 && positive(tick.price) && positive(tick.volume) && (tick.side === "ASK" || tick.side === "BID");
}

export class SqliteMarketMicrostructureStore {
  public constructor(
    private readonly db: SqliteDatabase,
    private readonly maximumSamplesPerMarket = 600_000,
    private readonly maximumTicksPerMarket = 2_000_000,
  ) {
    for (const value of [maximumSamplesPerMarket, maximumTicksPerMarket]) {
      if (!Number.isSafeInteger(value) || value < 10 || value > 50_000_000) throw new MarketMicrostructureStoreError("INVALID_RETENTION", "microstructure retention is invalid");
    }
  }

  /** Stores valid samples (invalid ones are skipped and counted); returns how many were newly stored and how many were rejected. */
  public appendOrderBookSamples(market: string, samples: readonly StoredOrderBookSample[]): { readonly stored: number; readonly rejected: number } {
    checkMarket(market);
    const valid = samples.filter(validSample);
    const stored = this.db.transaction(() => {
      let count = 0;
      const insert = this.db.connection.prepare("INSERT OR IGNORE INTO research_orderbook_samples (market, captured_at_ms, best_bid, best_ask, bid_size_5, ask_size_5, total_bid_size, total_ask_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      for (const s of valid) count += Number(insert.run(market, s.capturedAtMs, s.bestBid, s.bestAsk, s.bidSize5, s.askSize5, s.totalBidSize, s.totalAskSize).changes ?? 0);
      this.db.connection.prepare("DELETE FROM research_orderbook_samples WHERE market = ? AND captured_at_ms < (SELECT MIN(captured_at_ms) FROM (SELECT captured_at_ms FROM research_orderbook_samples WHERE market = ? ORDER BY captured_at_ms DESC LIMIT ?))").run(market, market, this.maximumSamplesPerMarket);
      return count;
    });
    return Object.freeze({ stored, rejected: samples.length - valid.length });
  }

  public appendTradeTicks(market: string, ticks: readonly StoredTradeTick[]): { readonly stored: number; readonly rejected: number } {
    checkMarket(market);
    const valid = ticks.filter(validTick);
    const stored = this.db.transaction(() => {
      let count = 0;
      const insert = this.db.connection.prepare("INSERT OR IGNORE INTO research_trade_ticks_v2 (market, traded_at_ms, price, volume, side) VALUES (?, ?, ?, ?, ?)");
      for (const t of valid) count += Number(insert.run(market, t.tradedAtMs, t.price, t.volume, t.side).changes ?? 0);
      this.db.connection.prepare("DELETE FROM research_trade_ticks_v2 WHERE market = ? AND traded_at_ms < (SELECT MIN(traded_at_ms) FROM (SELECT traded_at_ms FROM research_trade_ticks_v2 WHERE market = ? ORDER BY traded_at_ms DESC LIMIT ?))").run(market, market, this.maximumTicksPerMarket);
      return count;
    });
    return Object.freeze({ stored, rejected: ticks.length - valid.length });
  }

  public readOrderBookSamples(market: string, fromMs: number, toMs: number): readonly StoredOrderBookSample[] {
    checkMarket(market);
    const rows = this.db.connection.prepare("SELECT captured_at_ms, best_bid, best_ask, bid_size_5, ask_size_5, total_bid_size, total_ask_size FROM research_orderbook_samples WHERE market = ? AND captured_at_ms >= ? AND captured_at_ms <= ? ORDER BY captured_at_ms ASC").all(market, fromMs, toMs) as Array<Record<string, number>>;
    return Object.freeze(rows.map((r) => Object.freeze({ capturedAtMs: Number(r.captured_at_ms), bestBid: Number(r.best_bid), bestAsk: Number(r.best_ask), bidSize5: Number(r.bid_size_5), askSize5: Number(r.ask_size_5), totalBidSize: Number(r.total_bid_size), totalAskSize: Number(r.total_ask_size) })));
  }

  public readTradeTicks(market: string, fromMs: number, toMs: number): readonly StoredTradeTick[] {
    checkMarket(market);
    const rows = this.db.connection.prepare("SELECT traded_at_ms, price, volume, side FROM research_trade_ticks_v2 WHERE market = ? AND traded_at_ms >= ? AND traded_at_ms <= ? ORDER BY traded_at_ms ASC, price ASC").all(market, fromMs, toMs) as Array<Record<string, unknown>>;
    return Object.freeze(rows.map((r) => Object.freeze({ tradedAtMs: Number(r.traded_at_ms), price: Number(r.price), volume: Number(r.volume), side: String(r.side) as "ASK" | "BID" })));
  }

  /** Counts and the earliest/latest time per kind, for display. */
  public summary(): { readonly orderBookSamples: number; readonly tradeTicks: number; readonly firstAt?: number; readonly lastAt?: number } {
    const ob = this.db.connection.prepare("SELECT COUNT(*) AS n, MIN(captured_at_ms) AS a, MAX(captured_at_ms) AS b FROM research_orderbook_samples").get() as { n: number; a: number | null; b: number | null };
    const tt = this.db.connection.prepare("SELECT COUNT(*) AS n, MIN(traded_at_ms) AS a, MAX(traded_at_ms) AS b FROM research_trade_ticks_v2").get() as { n: number; a: number | null; b: number | null };
    const firsts = [ob.a, tt.a].filter((v): v is number => v != null);
    const lasts = [ob.b, tt.b].filter((v): v is number => v != null);
    return Object.freeze({ orderBookSamples: Number(ob.n), tradeTicks: Number(tt.n), ...(firsts.length ? { firstAt: Math.min(...firsts) } : {}), ...(lasts.length ? { lastAt: Math.max(...lasts) } : {}) });
  }
}
