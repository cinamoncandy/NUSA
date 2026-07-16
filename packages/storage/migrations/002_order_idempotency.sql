CREATE TABLE IF NOT EXISTS order_idempotency_records (
  idempotency_key TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  created_at_ms TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_idempotency_created_at
  ON order_idempotency_records (created_at_ms);
