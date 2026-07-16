import type {
  PositionReconciliationEvidenceRepository,
  PositionReconciliationResult
} from "../../../apps/execution/src/position-reconciliation";
import type { SqliteDatabase } from "./index";

type SqlRow = Record<string, string | number | bigint | null>;
const raw = (value: bigint | undefined): string | null => value == null ? null : value.toString();
const bigint = (value: SqlRow[string]): bigint | undefined => value == null ? undefined : BigInt(String(value));

function decode(row: SqlRow): PositionReconciliationResult {
  return Object.freeze({
    reconciliationId: String(row.reconciliation_id),
    accountId: String(row.account_id),
    symbol: String(row.symbol),
    status: String(row.status) as PositionReconciliationResult["status"],
    localBaseQtyRaw: BigInt(String(row.local_base_qty_raw)),
    providerBaseQtyRaw: bigint(row.provider_base_qty_raw),
    baseQtyDifferenceRaw: bigint(row.base_qty_difference_raw),
    localAvgEntryPriceRaw: bigint(row.local_avg_entry_price_raw),
    providerAvgEntryPriceRaw: bigint(row.provider_avg_entry_price_raw),
    avgEntryPriceDifferenceRaw: bigint(row.avg_entry_price_difference_raw),
    observedAtMs: Number(String(row.observed_at_ms)),
    restrictionId: row.restriction_id == null ? undefined : String(row.restriction_id),
    reason: row.reason == null ? undefined : String(row.reason)
  });
}

export class SqlitePositionReconciliationEvidenceRepository implements PositionReconciliationEvidenceRepository {
  public constructor(private readonly db: SqliteDatabase) {
    this.db.connection.exec(`
      CREATE TABLE IF NOT EXISTS position_reconciliation_results (
        reconciliation_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('MATCHED', 'MISMATCH', 'PROVIDER_UNAVAILABLE')),
        local_base_qty_raw TEXT NOT NULL,
        provider_base_qty_raw TEXT,
        base_qty_difference_raw TEXT,
        local_avg_entry_price_raw TEXT,
        provider_avg_entry_price_raw TEXT,
        avg_entry_price_difference_raw TEXT,
        observed_at_ms TEXT NOT NULL,
        restriction_id TEXT,
        reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_position_reconciliation_account_symbol_time
        ON position_reconciliation_results (account_id, symbol, observed_at_ms);
    `);
  }
  public append(result: PositionReconciliationResult): void {
    this.db.connection.prepare(`
      INSERT INTO position_reconciliation_results (
        reconciliation_id, account_id, symbol, status, local_base_qty_raw,
        provider_base_qty_raw, base_qty_difference_raw, local_avg_entry_price_raw,
        provider_avg_entry_price_raw, avg_entry_price_difference_raw, observed_at_ms,
        restriction_id, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(result.reconciliationId, result.accountId, result.symbol, result.status, raw(result.localBaseQtyRaw), raw(result.providerBaseQtyRaw), raw(result.baseQtyDifferenceRaw), raw(result.localAvgEntryPriceRaw), raw(result.providerAvgEntryPriceRaw), raw(result.avgEntryPriceDifferenceRaw), result.observedAtMs.toString(), result.restrictionId ?? null, result.reason ?? null);
  }
  public getById(reconciliationId: string): PositionReconciliationResult | undefined {
    const row = this.db.connection.prepare("SELECT * FROM position_reconciliation_results WHERE reconciliation_id = ?").get(reconciliationId) as SqlRow | undefined;
    return row == null ? undefined : decode(row);
  }
}
