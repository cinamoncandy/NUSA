CREATE TABLE IF NOT EXISTS position_ledger_entries (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL,
  strategy_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  base_qty_raw TEXT NOT NULL,
  quote_qty_raw TEXT,
  ts TEXT NOT NULL,
  created_at TEXT NOT NULL,
  source_trade_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_position_ledger_order
  ON position_ledger_entries (wallet_id, symbol, ts, created_at, id);

CREATE TABLE IF NOT EXISTS wallet_position_snapshots (
  wallet_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  base_qty_raw TEXT NOT NULL,
  quote_cost_raw TEXT NOT NULL,
  avg_entry_price_raw TEXT,
  realized_pnl_raw TEXT NOT NULL,
  status TEXT NOT NULL,
  last_ledger_entry_id TEXT,
  last_ledger_order_key TEXT,
  version INTEGER NOT NULL,
  PRIMARY KEY (wallet_id, symbol)
);

CREATE TABLE IF NOT EXISTS strategy_position_snapshots (
  wallet_id TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  base_qty_raw TEXT NOT NULL,
  quote_cost_raw TEXT NOT NULL,
  avg_entry_price_raw TEXT,
  realized_pnl_raw TEXT NOT NULL,
  status TEXT NOT NULL,
  last_ledger_entry_id TEXT,
  last_ledger_order_key TEXT,
  version INTEGER NOT NULL,
  PRIMARY KEY (wallet_id, strategy_id, symbol)
);

CREATE TABLE IF NOT EXISTS applied_ledger_markers (
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  ledger_entry_id TEXT NOT NULL,
  ledger_order_key TEXT NOT NULL,
  PRIMARY KEY (scope_type, scope_id, ledger_entry_id)
);
