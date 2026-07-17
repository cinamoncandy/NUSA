import type {
  BalanceReconciliationEvidenceRepository,
  BalanceReconciliationResult
} from "../../../apps/execution/src/balance-reconciliation";
import type { SqliteDatabase } from "./index";

type SqlRow = Record<string, string | number | bigint | null>;
const raw = (value: bigint | undefined): string | null => value == null ? null : value.toString();
const bigint = (value: SqlRow[string]): bigint | undefined => value == null ? undefined : BigInt(String(value));

function decode(row: SqlRow): BalanceReconciliationResult {
  return Object.freeze({
    reconciliationId: String(row.reconciliation_id),
    accountId: String(row.account_id),
    asset: String(row.asset),
    status: String(row.status) as BalanceReconciliationResult["status"],
    localWalletBalanceRaw: BigInt(String(row.local_wallet_balance_raw)),
    providerWalletBalanceRaw: bigint(row.provider_wallet_balance_raw),
    walletBalanceDifferenceRaw: bigint(row.wallet_balance_difference_raw),
    localAvailableBalanceRaw: BigInt(String(row.local_available_balance_raw)),
    providerAvailableBalanceRaw: bigint(row.provider_available_balance_raw),
    availableBalanceDifferenceRaw: bigint(row.available_balance_difference_raw),
    observedAtMs: Number(String(row.observed_at_ms)),
    restrictionId: row.restriction_id == null ? undefined : String(row.restriction_id),
    reason: row.reason == null ? undefined : String(row.reason)
  });
}

export class SqliteBalanceReconciliationEvidenceRepository implements BalanceReconciliationEvidenceRepository {
  public constructor(private readonly db: SqliteDatabase) {
    this.db.connection.exec(`
      CREATE TABLE IF NOT EXISTS balance_reconciliation_results (
        reconciliation_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        asset TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('MATCHED', 'MISMATCH', 'PROVIDER_UNAVAILABLE')),
        local_wallet_balance_raw TEXT NOT NULL,
        provider_wallet_balance_raw TEXT,
        wallet_balance_difference_raw TEXT,
        local_available_balance_raw TEXT NOT NULL,
        provider_available_balance_raw TEXT,
        available_balance_difference_raw TEXT,
        observed_at_ms TEXT NOT NULL,
        restriction_id TEXT,
        reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_balance_reconciliation_account_asset_time
        ON balance_reconciliation_results (account_id, asset, observed_at_ms, reconciliation_id);
    `);
  }

  public append(result: BalanceReconciliationResult): void {
    this.db.connection.prepare(`
      INSERT INTO balance_reconciliation_results (
        reconciliation_id, account_id, asset, status,
        local_wallet_balance_raw, provider_wallet_balance_raw, wallet_balance_difference_raw,
        local_available_balance_raw, provider_available_balance_raw, available_balance_difference_raw,
        observed_at_ms, restriction_id, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      result.reconciliationId,
      result.accountId,
      result.asset,
      result.status,
      raw(result.localWalletBalanceRaw),
      raw(result.providerWalletBalanceRaw),
      raw(result.walletBalanceDifferenceRaw),
      raw(result.localAvailableBalanceRaw),
      raw(result.providerAvailableBalanceRaw),
      raw(result.availableBalanceDifferenceRaw),
      result.observedAtMs.toString(),
      result.restrictionId ?? null,
      result.reason ?? null
    );
  }

  public getById(reconciliationId: string): BalanceReconciliationResult | undefined {
    const row = this.db.connection.prepare("SELECT * FROM balance_reconciliation_results WHERE reconciliation_id = ?").get(reconciliationId) as SqlRow | undefined;
    return row == null ? undefined : decode(row);
  }

  public getLatest(accountId: string, asset: string): BalanceReconciliationResult | undefined {
    const row = this.db.connection.prepare(`
      SELECT * FROM balance_reconciliation_results
      WHERE account_id = ? AND asset = ?
      ORDER BY CAST(observed_at_ms AS INTEGER) DESC, reconciliation_id DESC
      LIMIT 1
    `).get(accountId, asset) as SqlRow | undefined;
    return row == null ? undefined : decode(row);
  }
}
