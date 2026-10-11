import { createHash } from "node:crypto";
import type { SqliteDatabase } from "./index";

const TABLE = "research_closed_candles";
const MARKET = /^KRW-[A-Z0-9-]+$/;

/**
 * Durable store of CLOSED research candles. A candle is identified by (market, intervalMs, closeTimeMs) and is
 * immutable: appending an identical candle is a no-op, appending a different candle for the same key is a
 * conflict and throws. Rows carry a checksum that is verified on every read. Retention is bounded per market.
 * `volume` is deliberately not stored (ticker-derived candles have none).
 */
export interface StoredResearchCandle {
  readonly closeTimeMs: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

export class ResearchCandleStoreError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ResearchCandleStoreError";
  }
}

const price = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new ResearchCandleStoreError("INVALID_CANDLE", `research candle ${field} is invalid`);
  return value;
};

function rowChecksum(market: string, intervalMs: number, c: StoredResearchCandle): string {
  return createHash("sha256").update(JSON.stringify([market, intervalMs, c.closeTimeMs, c.open, c.high, c.low, c.close]), "utf8").digest("hex");
}

function validate(market: string, intervalMs: number, candle: StoredResearchCandle): StoredResearchCandle {
  if (typeof market !== "string" || !MARKET.test(market)) throw new ResearchCandleStoreError("INVALID_MARKET", "research candle market is invalid");
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000 || intervalMs > 86_400_000) throw new ResearchCandleStoreError("INVALID_INTERVAL", "research candle interval is invalid");
  if (!Number.isSafeInteger(candle.closeTimeMs) || candle.closeTimeMs <= 0 || candle.closeTimeMs % intervalMs !== 0) throw new ResearchCandleStoreError("INVALID_CANDLE", "research candle close time must be a positive multiple of the interval");
  const open = price(candle.open, "open");
  const high = price(candle.high, "high");
  const low = price(candle.low, "low");
  const close = price(candle.close, "close");
  if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) throw new ResearchCandleStoreError("INVALID_CANDLE", "research candle high/low do not bound open/close");
  return Object.freeze({ closeTimeMs: candle.closeTimeMs, open, high, low, close });
}

export class SqliteResearchCandleStore {
  public constructor(private readonly db: SqliteDatabase, private readonly maximumRowsPerMarket = 100_000) {
    if (!Number.isSafeInteger(maximumRowsPerMarket) || maximumRowsPerMarket < 2 || maximumRowsPerMarket > 5_000_000) throw new ResearchCandleStoreError("INVALID_RETENTION", "research candle retention is invalid");
  }

  /** Returns how many candles were newly recorded. Throws before writing anything if any candle is invalid or conflicts. */
  public append(market: string, intervalMs: number, candles: readonly StoredResearchCandle[]): number {
    const checked = candles.map((candle) => validate(market, intervalMs, candle));
    return this.db.transaction(() => {
      let recorded = 0;
      for (const candle of checked) {
        const existing = this.db.connection.prepare(`SELECT checksum FROM ${TABLE} WHERE market = ? AND interval_ms = ? AND close_time_ms = ?`).get(market, intervalMs, candle.closeTimeMs) as { checksum: string } | undefined;
        const checksum = rowChecksum(market, intervalMs, candle);
        if (existing != null) {
          if (existing.checksum !== checksum) throw new ResearchCandleStoreError("CANDLE_CONFLICT", "a different closed candle is already stored for this key");
          continue;
        }
        this.db.connection.prepare(`INSERT INTO ${TABLE} (market, interval_ms, close_time_ms, open, high, low, close, checksum) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(market, intervalMs, candle.closeTimeMs, candle.open, candle.high, candle.low, candle.close, checksum);
        recorded += 1;
      }
      this.db.connection.prepare(`DELETE FROM ${TABLE} WHERE market = ? AND interval_ms = ? AND close_time_ms NOT IN (SELECT close_time_ms FROM ${TABLE} WHERE market = ? AND interval_ms = ? ORDER BY close_time_ms DESC LIMIT ?)`).run(market, intervalMs, market, intervalMs, this.maximumRowsPerMarket);
      return recorded;
    });
  }

  /** Candles with fromCloseMs <= closeTimeMs <= toCloseMs, oldest first. Verifies every row checksum. */
  public read(market: string, intervalMs: number, fromCloseMs: number, toCloseMs: number): readonly StoredResearchCandle[] {
    if (!MARKET.test(market)) throw new ResearchCandleStoreError("INVALID_MARKET", "research candle market is invalid");
    if (!Number.isSafeInteger(fromCloseMs) || !Number.isSafeInteger(toCloseMs) || toCloseMs < fromCloseMs) throw new ResearchCandleStoreError("INVALID_WINDOW", "research candle window is invalid");
    const rows = this.db.connection.prepare(`SELECT close_time_ms, open, high, low, close, checksum FROM ${TABLE} WHERE market = ? AND interval_ms = ? AND close_time_ms >= ? AND close_time_ms <= ? ORDER BY close_time_ms ASC`).all(market, intervalMs, fromCloseMs, toCloseMs) as Array<Record<string, unknown>>;
    return Object.freeze(rows.map((row) => {
      const candle = validate(market, intervalMs, { closeTimeMs: Number(row.close_time_ms), open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close) });
      if (rowChecksum(market, intervalMs, candle) !== String(row.checksum)) throw new ResearchCandleStoreError("CANDLE_CHECKSUM_MISMATCH", "persisted research candle checksum mismatch");
      return candle;
    }));
  }

  /** Earliest stored close time for a market/interval, or undefined when empty. */
  public earliestCloseTime(market: string, intervalMs: number): number | undefined {
    const row = this.db.connection.prepare(`SELECT MIN(close_time_ms) AS earliest FROM ${TABLE} WHERE market = ? AND interval_ms = ?`).get(market, intervalMs) as { earliest: number | null } | undefined;
    return row?.earliest == null ? undefined : Number(row.earliest);
  }

  /** Latest stored close time for a market/interval, or undefined when empty. */
  public latestCloseTime(market: string, intervalMs: number): number | undefined {
    if (!MARKET.test(market)) throw new ResearchCandleStoreError("INVALID_MARKET", "research candle market is invalid");
    const row = this.db.connection.prepare(`SELECT MAX(close_time_ms) AS latest FROM ${TABLE} WHERE market = ? AND interval_ms = ?`).get(market, intervalMs) as { latest: number | null } | undefined;
    return row?.latest == null ? undefined : Number(row.latest);
  }

  public count(market: string, intervalMs: number): number {
    const row = this.db.connection.prepare(`SELECT COUNT(*) AS n FROM ${TABLE} WHERE market = ? AND interval_ms = ?`).get(market, intervalMs) as { n: number };
    return Number(row.n);
  }
}
