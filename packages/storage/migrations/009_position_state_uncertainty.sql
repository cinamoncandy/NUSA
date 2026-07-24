PRAGMA foreign_keys=OFF;

CREATE TABLE order_operational_restrictions_next (
  restriction_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('CRITICAL_UNKNOWN_SUBMISSION', 'POSITION_MISMATCH', 'POSITION_STATE_UNCERTAIN')),
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
  ON order_operational_restrictions (account_id)
  WHERE status = 'ACTIVE';

PRAGMA foreign_keys=ON;
