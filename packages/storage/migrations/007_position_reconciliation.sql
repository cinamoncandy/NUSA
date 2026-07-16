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
