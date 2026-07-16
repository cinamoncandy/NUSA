CREATE TABLE IF NOT EXISTS pnl_reconciliation_results (
  reconciliation_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  status TEXT NOT NULL,
  local_account_id TEXT NOT NULL,
  local_asset TEXT NOT NULL,
  local_realized_raw TEXT NOT NULL,
  local_unrealized_raw TEXT NOT NULL,
  local_funding_raw TEXT NOT NULL,
  local_fee_raw TEXT NOT NULL,
  local_observed_at_ms TEXT NOT NULL,
  provider_account_id TEXT,
  provider_asset TEXT,
  provider_realized_raw TEXT,
  provider_unrealized_raw TEXT,
  provider_funding_raw TEXT,
  provider_fee_raw TEXT,
  provider_observed_at_ms TEXT,
  observed_at_ms TEXT NOT NULL,
  restriction_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_pnl_reconciliation_latest
  ON pnl_reconciliation_results(account_id, asset, observed_at_ms, reconciliation_id);
