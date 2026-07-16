CREATE TABLE IF NOT EXISTS order_operational_restrictions (
  restriction_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('CRITICAL_UNKNOWN_SUBMISSION', 'POSITION_MISMATCH')),
  source_run_id TEXT NOT NULL,
  source_intent_ids_json TEXT NOT NULL,
  block_new_exposure INTEGER NOT NULL CHECK (block_new_exposure = 1),
  manual_release_required INTEGER NOT NULL CHECK (manual_release_required = 1),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'RELEASED')),
  created_at_ms TEXT NOT NULL,
  released_at_ms TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_operational_restrictions_active_account
  ON order_operational_restrictions (account_id)
  WHERE status = 'ACTIVE';
