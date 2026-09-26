import type { SqliteMigration } from "./migrationRunner";

/**
 * Durable receipt for the one recognized pre-fixed-point PAPER accounting
 * migration. The runtime performs the semantic proof and writes this receipt
 * atomically with fill-ledger backfill + canonical account restoration.
 */
export const cloudPaperLegacyReconciliationMigration: SqliteMigration = Object.freeze({
  id: "025_cloud_paper_legacy_reconciliation_receipts",
  sql: `
CREATE TABLE IF NOT EXISTS cloud_paper_legacy_reconciliation_receipts (
  account_id TEXT NOT NULL,
  migration_version TEXT NOT NULL,
  source_updated_at INTEGER NOT NULL,
  source_checksum TEXT NOT NULL,
  fill_count INTEGER NOT NULL,
  canonical_ledger_fingerprint TEXT NOT NULL,
  migrated_updated_at INTEGER NOT NULL,
  migrated_account_checksum TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  receipt_checksum TEXT NOT NULL,
  PRIMARY KEY (account_id, migration_version, source_checksum)
);
CREATE INDEX IF NOT EXISTS idx_cloud_paper_legacy_reconciliation_time
  ON cloud_paper_legacy_reconciliation_receipts (account_id, migrated_updated_at ASC);
`,
});
