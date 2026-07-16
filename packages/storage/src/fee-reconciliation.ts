import type { FeeReconciliationEvidenceRepository, FeeReconciliationResult } from "../../../apps/execution/src/fee-reconciliation";
import type { SqliteDatabase } from "./index";

type SqlRow = Record<string, string | number | bigint | null>;
function decode(row: SqlRow): FeeReconciliationResult {
  return Object.freeze({
    reconciliationId: String(row.reconciliation_id),
    accountId: String(row.account_id),
    status: String(row.status) as FeeReconciliationResult["status"],
    localCount: Number(String(row.local_count)),
    providerCount: Number(String(row.provider_count)),
    mismatchTradeIds: Object.freeze(JSON.parse(String(row.mismatch_trade_ids_json)) as string[]),
    observedAtMs: Number(String(row.observed_at_ms)),
    restrictionId: row.restriction_id == null ? undefined : String(row.restriction_id),
    reason: row.reason == null ? undefined : String(row.reason)
  });
}
export class SqliteFeeReconciliationEvidenceRepository implements FeeReconciliationEvidenceRepository {
  public constructor(private readonly db: SqliteDatabase) {
    this.db.connection.exec(`
      CREATE TABLE IF NOT EXISTS fee_reconciliation_results (
        reconciliation_id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
        status TEXT NOT NULL, local_count INTEGER NOT NULL, provider_count INTEGER NOT NULL,
        mismatch_trade_ids_json TEXT NOT NULL, observed_at_ms TEXT NOT NULL,
        restriction_id TEXT, reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_fee_reconciliation_account_time
        ON fee_reconciliation_results (account_id, observed_at_ms, reconciliation_id);
    `);
  }
  append(result: FeeReconciliationResult): void {
    this.db.connection.prepare(`INSERT INTO fee_reconciliation_results (
      reconciliation_id, account_id, status, local_count, provider_count,
      mismatch_trade_ids_json, observed_at_ms, restriction_id, reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(result.reconciliationId, result.accountId, result.status, result.localCount, result.providerCount, JSON.stringify([...result.mismatchTradeIds].sort()), result.observedAtMs.toString(), result.restrictionId ?? null, result.reason ?? null);
  }
  getById(reconciliationId: string): FeeReconciliationResult | undefined {
    const row = this.db.connection.prepare("SELECT * FROM fee_reconciliation_results WHERE reconciliation_id = ?").get(reconciliationId) as SqlRow | undefined;
    return row == null ? undefined : decode(row);
  }
  getLatest(accountId: string): FeeReconciliationResult | undefined {
    const row = this.db.connection.prepare("SELECT * FROM fee_reconciliation_results WHERE account_id = ? ORDER BY CAST(observed_at_ms AS INTEGER) DESC, reconciliation_id DESC LIMIT 1").get(accountId) as SqlRow | undefined;
    return row == null ? undefined : decode(row);
  }
}
