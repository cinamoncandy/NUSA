import type { SqliteMigration } from "./migrationRunner";

export const cloudPaperFillLedgerMigration: SqliteMigration = {
  id: "023_cloud_paper_fill_ledger",
  sql: `
CREATE TABLE IF NOT EXISTS cloud_paper_fill_ledger (
  account_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  fill_id TEXT NOT NULL,
  filled_at INTEGER NOT NULL,
  fill_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  PRIMARY KEY (account_id, sequence),
  UNIQUE (account_id, fill_id)
);
CREATE INDEX IF NOT EXISTS idx_cloud_paper_fill_ledger_time
  ON cloud_paper_fill_ledger (account_id, filled_at ASC, fill_id ASC);
`
};
