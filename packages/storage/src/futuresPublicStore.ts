import type { SqliteDatabase } from "./index";

const SYMBOL = /^[A-Z0-9]{3,20}USDT$/;
const INTERVAL = /^(1m|5m|15m|1h|4h|1d)$/;
const finitePositive = (v: number): boolean => Number.isFinite(v) && v > 0;
const posInt = (v: number): boolean => Number.isSafeInteger(v) && v > 0;

export interface FuturesMarkRow { readonly symbol: string; readonly capturedAtMs: number; readonly markPrice: number; readonly indexPrice: number; readonly lastFundingRate: number; readonly nextFundingTimeMs: number }
export interface FuturesFundingRow { readonly symbol: string; readonly fundingTimeMs: number; readonly fundingRate: number }
export interface FuturesKlineRow { readonly symbol: string; readonly interval: string; readonly openTimeMs: number; readonly closeTimeMs: number; readonly open: number; readonly high: number; readonly low: number; readonly close: number; readonly volume: number }

const validMark = (r: FuturesMarkRow): boolean => SYMBOL.test(r.symbol) && posInt(r.capturedAtMs) && finitePositive(r.markPrice) && finitePositive(r.indexPrice) && Number.isFinite(r.lastFundingRate) && posInt(r.nextFundingTimeMs);
const validFunding = (r: FuturesFundingRow): boolean => SYMBOL.test(r.symbol) && posInt(r.fundingTimeMs) && Number.isFinite(r.fundingRate);
const validKline = (r: FuturesKlineRow): boolean => SYMBOL.test(r.symbol) && INTERVAL.test(r.interval) && posInt(r.openTimeMs) && posInt(r.closeTimeMs) && r.closeTimeMs > r.openTimeMs
  && [r.open, r.high, r.low, r.close].every(finitePositive) && r.high >= Math.max(r.open, r.close, r.low) && r.low <= Math.min(r.open, r.close) && Number.isFinite(r.volume) && r.volume >= 0;

/**
 * Research-only store of PUBLIC Binance USD-M futures data (mark price / funding / closed klines). It exists so a futures research
 * question can be answered from recorded data (WO-FUTURES-20261014-BINANCE-PUBLIC-PROBE). No account, order or position data.
 * Appends are idempotent per key; invalid rows are skipped and counted.
 */
export class SqliteFuturesPublicStore {
  public constructor(private readonly db: SqliteDatabase) {}

  private insert<T>(rows: readonly T[], valid: (r: T) => boolean, sql: string, args: (r: T) => (string | number)[]): { readonly stored: number; readonly rejected: number } {
    const ok = rows.filter(valid);
    const stored = this.db.transaction(() => {
      const stmt = this.db.connection.prepare(sql);
      let n = 0;
      for (const r of ok) n += Number(stmt.run(...args(r)).changes ?? 0);
      return n;
    });
    return Object.freeze({ stored, rejected: rows.length - ok.length });
  }

  public appendMarks(rows: readonly FuturesMarkRow[]) {
    return this.insert(rows, validMark, "INSERT OR IGNORE INTO research_futures_marks (symbol, captured_at_ms, mark_price, index_price, last_funding_rate, next_funding_time_ms) VALUES (?, ?, ?, ?, ?, ?)",
      (r) => [r.symbol, r.capturedAtMs, r.markPrice, r.indexPrice, r.lastFundingRate, r.nextFundingTimeMs]);
  }
  public appendFunding(rows: readonly FuturesFundingRow[]) {
    return this.insert(rows, validFunding, "INSERT OR IGNORE INTO research_futures_funding (symbol, funding_time_ms, funding_rate) VALUES (?, ?, ?)", (r) => [r.symbol, r.fundingTimeMs, r.fundingRate]);
  }
  public appendKlines(rows: readonly FuturesKlineRow[]) {
    return this.insert(rows, validKline, "INSERT OR IGNORE INTO research_futures_klines (symbol, interval, open_time_ms, close_time_ms, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      (r) => [r.symbol, r.interval, r.openTimeMs, r.closeTimeMs, r.open, r.high, r.low, r.close, r.volume]);
  }
  /** Time-based retention for the 1-minute mark samples (funding and klines are small and kept). */
  public pruneMarksBefore(cutoffMs: number): number {
    if (!posInt(cutoffMs)) throw new Error("INVALID_CUTOFF");
    return this.db.transaction(() => Number(this.db.connection.prepare("DELETE FROM research_futures_marks WHERE captured_at_ms < ?").run(cutoffMs).changes ?? 0));
  }
}
