import type { SqliteDatabase } from "./index";

const TABLE = "research_holdout_usage";
const MARKET = /^KRW-[A-Z0-9-]+$/;
const SHA256 = /^[a-f0-9]{64}$/;

/**
 * Durable record that a holdout window was evaluated for a strategy configuration. A holdout may be used
 * at most once per (strategy configuration, market, interval, window): `claim` is atomic and a second claim
 * is refused, which is what lets provenance state `finalHoldoutUntouched` truthfully across restarts.
 * Records are never updated or deleted by this class.
 */
export interface HoldoutKey {
  readonly strategyConfigHash: string;
  readonly market: string;
  readonly intervalMs: number;
  readonly holdoutStartMs: number;
  readonly holdoutEndMs: number;
}

export class ResearchHoldoutLedgerError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ResearchHoldoutLedgerError";
  }
}

function check(key: HoldoutKey): void {
  if (typeof key.strategyConfigHash !== "string" || !SHA256.test(key.strategyConfigHash)) throw new ResearchHoldoutLedgerError("INVALID_KEY", "strategy configuration hash must be a SHA-256");
  if (typeof key.market !== "string" || !MARKET.test(key.market)) throw new ResearchHoldoutLedgerError("INVALID_KEY", "market is invalid");
  if (!Number.isSafeInteger(key.intervalMs) || key.intervalMs < 1_000) throw new ResearchHoldoutLedgerError("INVALID_KEY", "interval is invalid");
  if (!Number.isSafeInteger(key.holdoutStartMs) || !Number.isSafeInteger(key.holdoutEndMs) || key.holdoutStartMs <= 0 || key.holdoutEndMs < key.holdoutStartMs) throw new ResearchHoldoutLedgerError("INVALID_KEY", "holdout window is invalid");
}

export class SqliteResearchHoldoutLedger {
  public constructor(private readonly db: SqliteDatabase) {}

  /** CLAIMED the first time, ALREADY_USED every time after. */
  public claim(key: HoldoutKey, evaluationId: string, usedAtMs: number): "CLAIMED" | "ALREADY_USED" {
    check(key);
    if (typeof evaluationId !== "string" || evaluationId.trim() === "") throw new ResearchHoldoutLedgerError("INVALID_EVALUATION", "evaluation id is required");
    if (!Number.isSafeInteger(usedAtMs) || usedAtMs <= 0) throw new ResearchHoldoutLedgerError("INVALID_CLOCK", "claim time is invalid");
    return this.db.transaction(() => {
      if (this.isUsed(key)) return "ALREADY_USED";
      this.db.connection.prepare(`INSERT INTO ${TABLE} (strategy_config_hash, market, interval_ms, holdout_start_ms, holdout_end_ms, evaluation_id, used_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(key.strategyConfigHash, key.market, key.intervalMs, key.holdoutStartMs, key.holdoutEndMs, evaluationId, usedAtMs);
      return "CLAIMED";
    });
  }

  public isUsed(key: HoldoutKey): boolean {
    check(key);
    const row = this.db.connection.prepare(`SELECT 1 AS used FROM ${TABLE} WHERE strategy_config_hash = ? AND market = ? AND interval_ms = ? AND holdout_start_ms = ? AND holdout_end_ms = ?`).get(key.strategyConfigHash, key.market, key.intervalMs, key.holdoutStartMs, key.holdoutEndMs);
    return row != null;
  }

  /**
   * True when this strategy configuration has already been evaluated on any holdout window that overlaps
   * [startMs, endMs] for the market and interval (an overlapping holdout is contaminated even if not identical).
   */
  public overlapsUsedHoldout(strategyConfigHash: string, market: string, intervalMs: number, startMs: number, endMs: number): boolean {
    check({ strategyConfigHash, market, intervalMs, holdoutStartMs: startMs, holdoutEndMs: endMs });
    const row = this.db.connection.prepare(`SELECT 1 AS used FROM ${TABLE} WHERE strategy_config_hash = ? AND market = ? AND interval_ms = ? AND holdout_start_ms <= ? AND holdout_end_ms >= ? LIMIT 1`).get(strategyConfigHash, market, intervalMs, endMs, startMs);
    return row != null;
  }

  public count(): number {
    const row = this.db.connection.prepare(`SELECT COUNT(*) AS n FROM ${TABLE}`).get() as { n: number };
    return Number(row.n);
  }
}
