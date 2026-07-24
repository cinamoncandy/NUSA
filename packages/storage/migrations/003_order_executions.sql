CREATE TABLE IF NOT EXISTS order_execution_records (
  execution_id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SUBMITTING', 'ACCEPTED', 'REJECTED', 'SUBMISSION_UNKNOWN')),
  provider_order_id TEXT,
  reason TEXT,
  created_at_ms TEXT NOT NULL,
  updated_at_ms TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_execution_status_updated
  ON order_execution_records (status, updated_at_ms);
