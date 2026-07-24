CREATE TABLE IF NOT EXISTS order_reconciliation_runs (
  run_id TEXT PRIMARY KEY,
  started_at_ms TEXT NOT NULL,
  scanned_count INTEGER NOT NULL,
  resolved_count INTEGER NOT NULL,
  unresolved_count INTEGER NOT NULL,
  overdue_count INTEGER NOT NULL,
  critical_count INTEGER NOT NULL,
  truncated INTEGER NOT NULL CHECK (truncated IN (0, 1))
);

CREATE TABLE IF NOT EXISTS order_reconciliation_items (
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  intent_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  age_ms TEXT NOT NULL,
  age_status TEXT NOT NULL CHECK (age_status IN ('RECENT', 'OVERDUE', 'CRITICAL')),
  before_status TEXT NOT NULL,
  after_status TEXT NOT NULL,
  resolved INTEGER NOT NULL CHECK (resolved IN (0, 1)),
  lookup_status TEXT NOT NULL,
  PRIMARY KEY (run_id, sequence),
  FOREIGN KEY (run_id) REFERENCES order_reconciliation_runs(run_id)
);

CREATE INDEX IF NOT EXISTS idx_order_reconciliation_runs_started
  ON order_reconciliation_runs (started_at_ms, run_id);
CREATE INDEX IF NOT EXISTS idx_order_reconciliation_items_intent
  ON order_reconciliation_items (intent_id, run_id);
