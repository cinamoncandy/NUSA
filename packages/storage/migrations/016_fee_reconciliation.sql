CREATE TABLE IF NOT EXISTS fee_reconciliation_results (
  reconciliation_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'MATCHED', 'MISSING_LOCAL', 'MISSING_PROVIDER', 'AMOUNT_MISMATCH',
    'ASSET_MISMATCH', 'LIQUIDITY_ROLE_MISMATCH', 'DUPLICATE_LOCAL',
    'DUPLICATE_PROVIDER', 'PROVIDER_UNAVAILABLE'
  )),
  local_count INTEGER NOT NULL,
  provider_count INTEGER NOT NULL,
  mismatch_trade_ids_json TEXT NOT NULL,
  observed_at_ms TEXT NOT NULL,
  restriction_id TEXT,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_fee_reconciliation_account_time
  ON fee_reconciliation_results (account_id, observed_at_ms, reconciliation_id);
