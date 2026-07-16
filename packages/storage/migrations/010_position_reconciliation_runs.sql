CREATE TABLE IF NOT EXISTS position_reconciliation_runs (
  run_id TEXT PRIMARY KEY,
  started_at_ms TEXT NOT NULL,
  scanned_count INTEGER NOT NULL,
  matched_count INTEGER NOT NULL,
  mismatch_count INTEGER NOT NULL,
  unavailable_count INTEGER NOT NULL,
  restriction_count INTEGER NOT NULL,
  truncated INTEGER NOT NULL CHECK (truncated IN (0, 1)),
  reconciliation_ids_json TEXT NOT NULL
);
