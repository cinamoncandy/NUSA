CREATE TABLE IF NOT EXISTS fill_reconciliation_results (
  reconciliation_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  status TEXT NOT NULL,
  local_count INTEGER NOT NULL,
  provider_count INTEGER NOT NULL,
  mismatch_fill_ids_json TEXT NOT NULL,
  observed_at_ms TEXT NOT NULL,
  restriction_id TEXT,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_fill_reconciliation_account_time
  ON fill_reconciliation_results(account_id, observed_at_ms);
