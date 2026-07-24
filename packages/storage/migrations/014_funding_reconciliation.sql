CREATE TABLE funding_reconciliation_results (
  reconciliation_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'MATCHED', 'MISSING_LOCAL', 'MISSING_PROVIDER', 'AMOUNT_MISMATCH',
    'DUPLICATE_LOCAL', 'DUPLICATE_PROVIDER', 'PROVIDER_UNAVAILABLE'
  )),
  local_count INTEGER NOT NULL,
  provider_count INTEGER NOT NULL,
  mismatch_funding_ids_json TEXT NOT NULL,
  observed_at_ms TEXT NOT NULL,
  restriction_id TEXT,
  reason TEXT
);

CREATE INDEX idx_funding_reconciliation_account_time
  ON funding_reconciliation_results (account_id, observed_at_ms);

PRAGMA foreign_keys=OFF;
CREATE TABLE order_operational_restrictions_next (
  restriction_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN (
    'CRITICAL_UNKNOWN_SUBMISSION', 'POSITION_MISMATCH', 'POSITION_STATE_UNCERTAIN',
    'POSITION_RECONCILIATION_STALE', 'BALANCE_MISMATCH', 'BALANCE_STATE_UNCERTAIN',
    'BALANCE_RECONCILIATION_STALE', 'FUNDING_RECONCILIATION_MISMATCH',
    'FUNDING_STATE_UNCERTAIN'
  )),
  source_run_id TEXT NOT NULL,
  source_intent_ids_json TEXT NOT NULL,
  block_new_exposure INTEGER NOT NULL CHECK (block_new_exposure = 1),
  manual_release_required INTEGER NOT NULL CHECK (manual_release_required = 1),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'RELEASED')),
  created_at_ms TEXT NOT NULL,
  released_at_ms TEXT
);
INSERT INTO order_operational_restrictions_next
SELECT restriction_id, account_id, reason, source_run_id, source_intent_ids_json,
       block_new_exposure, manual_release_required, status, created_at_ms, released_at_ms
FROM order_operational_restrictions;
DROP TABLE order_operational_restrictions;
ALTER TABLE order_operational_restrictions_next RENAME TO order_operational_restrictions;
CREATE UNIQUE INDEX idx_order_operational_restrictions_active_account
  ON order_operational_restrictions (account_id) WHERE status = 'ACTIVE';
PRAGMA foreign_keys=ON;
