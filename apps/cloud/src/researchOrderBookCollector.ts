import type { StoredOrderBookSample } from "../../../packages/storage/src/marketMicrostructureStore";

/**
 * Research-only collector of the public Upbit order book for every KRW market (owner decision 2026-10-13, option A;
 * WO-RESEARCH-20261014-ORDERBOOK-COLLECTOR). The meta-learner's next recommendation is ORDERBOOK+INTRADAY+ALL_KRW+ML, but the
 * WebSocket recorder only sees the few markets the runtime subscribes to and Upbit keeps no order-book history.
 *
 * Once a minute it requests /v1/orderbook for all KRW markets in chunks and stores one top-of-book summary per market. It places
 * no order and feeds no PAPER, Risk, Governance or qualification decision. Markets the WebSocket recorder already samples are
 * skipped (they keep that recorder's count-based retention); the rows written here are pruned by age (14 days). Every failure is
 * caught and counted, a round never overlaps the previous one, and NUSA_RESEARCH_ORDERBOOK_COLLECTOR=DISABLED turns it off.
 */
export interface OrderBookRoundSink {
  readonly appendOrderBookRound: (rows: readonly { readonly market: string; readonly sample: StoredOrderBookSample }[]) => { readonly stored: number; readonly rejected: number };
  readonly pruneOrderBookSamplesBefore: (markets: readonly string[], cutoffMs: number) => number;
}

export interface ResearchOrderBookCollectorStatus {
  readonly rounds: number;
  readonly markets: number;
  readonly samplesStored: number;
  readonly failures: number;
  /** Books rejected for a wrong market, a future or missing exchange timestamp, or invalid values. */
  readonly rejected: number;
  readonly lastRoundAt?: number;
}

export const ORDERBOOK_COLLECTOR_INTERVAL_MS = 60_000;
/**
 * Upbit's REST order-book `timestamp` is the book's LAST CHANGE, not the observation time: an illiquid market's unchanged book is
 * still its current state (measured 2026-10-14: 4 of 295 books older than 120 s, all illiquid). Rows are therefore stamped with
 * the local observation time (as the WebSocket recorder does), which is when the state was actually known; the exchange timestamp
 * is only checked for the future (beyond ORDERBOOK_MAX_FUTURE_MS of clock skew).
 */
export const ORDERBOOK_MAX_FUTURE_MS = 5_000;
export const ORDERBOOK_COLLECTOR_RETENTION_MS = 14 * 24 * 3_600_000;
/**
 * Retention for the stored books. The default stays 14 days. NUSA_RESEARCH_ORDERBOOK_RETENTION_DAYS may raise it (whole days, 14..90)
 * so a pre-registered study can still read its training data when its verdict is due. A value below 14 or not a whole number keeps 14, above 90 uses 90,
 * and researchOrderBookRetention returns a warning for the log in each of those cases. The collector never keeps less than 14 days.
 * Raising it grows the state database (and every backup copy of it), so the owner sets it deliberately after checking disk headroom.
 */
export function researchOrderBookRetentionMs(env: NodeJS.ProcessEnv): number {
  return researchOrderBookRetention(env).retentionMs;
}

/** The effective retention and, when NUSA_RESEARCH_ORDERBOOK_RETENTION_DAYS was set but unusable or clamped, a warning sentence for the log. */
export function researchOrderBookRetention(env: NodeJS.ProcessEnv): { readonly retentionMs: number; readonly warning?: string } {
  const raw = env.NUSA_RESEARCH_ORDERBOOK_RETENTION_DAYS;
  if (raw == null || raw.trim() === "") return { retentionMs: ORDERBOOK_COLLECTOR_RETENTION_MS };
  const text = raw.trim();
  if (!/^\d{1,3}$/.test(text) || Number(text) === 0 || text.length > 1 && text.startsWith("0")) return { retentionMs: ORDERBOOK_COLLECTOR_RETENTION_MS, warning: `NUSA_RESEARCH_ORDERBOOK_RETENTION_DAYS=${JSON.stringify(text.slice(0, 20))} is not a whole number of days; keeping 14 days.` };
  const days = Number(text);
  if (days < 14) return { retentionMs: ORDERBOOK_COLLECTOR_RETENTION_MS, warning: `NUSA_RESEARCH_ORDERBOOK_RETENTION_DAYS=${days} is below the 14-day minimum; keeping 14 days.` };
  if (days > 90) return { retentionMs: 90 * 24 * 3_600_000, warning: `NUSA_RESEARCH_ORDERBOOK_RETENTION_DAYS=${days} is above the 90-day maximum; using 90 days.` };
  return { retentionMs: days * 24 * 3_600_000 };
}

const CHUNK = 20;
const MARKET_LIST_TTL_MS = 6 * 3_600_000;
const PRUNE_EVERY_MS = 3_600_000;
const MARKET = /^KRW-[A-Z0-9-]+$/;

export function researchOrderBookCollectorEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.NUSA_RESEARCH_ORDERBOOK_COLLECTOR !== "DISABLED";
}

type Unit = { ask_price: number; bid_price: number; ask_size: number; bid_size: number };
type Book = { market: string; timestamp: number; total_ask_size: number; total_bid_size: number; orderbook_units: Unit[] };

export class ResearchOrderBookCollector {
  private rounds = 0;
  private samplesStored = 0;
  private failures = 0;
  private rejected = 0;
  private lastRoundAt: number | undefined;
  private markets: string[] = [];
  private marketsAt = 0;
  private lastPruneAt = 0;
  private running = false;
  private timer: ReturnType<typeof setInterval> | undefined;

  public constructor(
    private readonly sink: OrderBookRoundSink,
    private readonly options: {
      readonly fetchImpl?: typeof fetch;
      readonly now?: () => number;
      readonly skipMarkets?: () => ReadonlySet<string>;
      readonly sleep?: (ms: number) => Promise<void>;
      /** How long books are kept; defaults to ORDERBOOK_COLLECTOR_RETENTION_MS. */
      readonly retentionMs?: number;
    } = {},
  ) {}

  private get now(): number { return (this.options.now ?? Date.now)(); }

  private async getJson(url: string): Promise<unknown> {
    const response = await (this.options.fetchImpl ?? fetch)(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return response.json();
  }

  private async refreshMarkets(): Promise<void> {
    if (this.markets.length > 0 && this.now - this.marketsAt < MARKET_LIST_TTL_MS) return;
    const list = await this.getJson("https://api.upbit.com/v1/market/all");
    if (!Array.isArray(list)) throw new Error("MARKET_LIST_INVALID");
    const markets = list.map((m) => String((m as { market?: unknown }).market ?? "")).filter((m) => MARKET.test(m));
    if (markets.length === 0) throw new Error("MARKET_LIST_EMPTY");
    this.markets = markets;
    this.marketsAt = this.now;
  }

  /** One collection round; never throws. Returns the number of samples stored. */
  public async collectOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let stored = 0;
    try {
      await this.refreshMarkets();
      let skip: ReadonlySet<string> = new Set();
      try { skip = this.options.skipMarkets?.() ?? skip; } catch { /* collect every market */ }
      const targets = this.markets.filter((m) => !skip.has(m));
      for (let i = 0; i < targets.length; i += CHUNK) {
        try {
          const requested = targets.slice(i, i + CHUNK);
          const books = await this.getJson(`https://api.upbit.com/v1/orderbook?markets=${requested.join(",")}`);
          if (!Array.isArray(books)) throw new Error("ORDERBOOK_INVALID");
          // Data integrity: keep only books for a market this request asked for whose exchange timestamp is not in the future;
          // anything else is counted, never stored. Rows are stamped with the local observation time (see ORDERBOOK_MAX_FUTURE_MS).
          const roundNow = this.now;
          const accepted = (books as Book[]).filter((b) => {
            const ok = b != null && requested.includes(String(b.market)) && Array.isArray(b.orderbook_units) && b.orderbook_units.length > 0
              && Number.isSafeInteger(b.timestamp) && b.timestamp > 0 && b.timestamp <= roundNow + ORDERBOOK_MAX_FUTURE_MS;
            if (!ok) this.rejected += 1;
            return ok;
          });
          const rows = accepted.map((b) => {
            const top = b.orderbook_units.slice(0, 5);
            return {
              market: String(b.market),
              sample: {
                capturedAtMs: roundNow,
                bestBid: b.orderbook_units[0]!.bid_price,
                bestAsk: b.orderbook_units[0]!.ask_price,
                bidSize5: top.reduce((sum, u) => sum + u.bid_size, 0),
                askSize5: top.reduce((sum, u) => sum + u.ask_size, 0),
                totalBidSize: b.total_bid_size,
                totalAskSize: b.total_ask_size,
              },
            };
          });
          const result = this.sink.appendOrderBookRound(rows);
          stored += result.stored;
          this.rejected += result.rejected;
        } catch { this.failures += 1; }
        await (this.options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))))(150);
      }
      if (this.now - this.lastPruneAt >= PRUNE_EVERY_MS) {
        this.lastPruneAt = this.now;
        try { this.sink.pruneOrderBookSamplesBefore(targets, this.now - Math.max(this.options.retentionMs ?? ORDERBOOK_COLLECTOR_RETENTION_MS, ORDERBOOK_COLLECTOR_RETENTION_MS)); } catch { this.failures += 1; }
      }
      this.rounds += 1;
      this.samplesStored += stored;
      this.lastRoundAt = this.now;
    } catch { this.failures += 1; } finally { this.running = false; }
    return stored;
  }

  public start(): void {
    if (this.timer != null) return;
    this.timer = setInterval(() => { void this.collectOnce(); }, ORDERBOOK_COLLECTOR_INTERVAL_MS);
    this.timer.unref?.();
  }

  public stop(): void {
    if (this.timer != null) clearInterval(this.timer);
    this.timer = undefined;
  }

  public status(): ResearchOrderBookCollectorStatus {
    return Object.freeze({ rounds: this.rounds, markets: this.markets.length, samplesStored: this.samplesStored, failures: this.failures, rejected: this.rejected, ...(this.lastRoundAt === undefined ? {} : { lastRoundAt: this.lastRoundAt }) });
  }
}
