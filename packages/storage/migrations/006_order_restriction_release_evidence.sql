CREATE TABLE IF NOT EXISTS order_operational_restriction_release_evidence (
  release_id TEXT PRIMARY KEY,
  restriction_id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  verified_by TEXT NOT NULL,
  rationale TEXT NOT NULL,
  verified_intent_ids_json TEXT NOT NULL,
  released_at_ms TEXT NOT NULL,
  CHECK (requested_by <> verified_by),
  FOREIGN KEY (restriction_id) REFERENCES order_operational_restrictions(restriction_id)
);
