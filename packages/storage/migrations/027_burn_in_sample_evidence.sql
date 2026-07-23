ALTER TABLE burn_in_evidence ADD COLUMN required_samples INTEGER;
ALTER TABLE burn_in_evidence ADD COLUMN minimum_duration_ms INTEGER;
ALTER TABLE burn_in_evidence ADD COLUMN maximum_critical_failures INTEGER;
ALTER TABLE burn_in_evidence ADD COLUMN maximum_unknown_samples INTEGER;

CREATE TABLE IF NOT EXISTS burn_in_samples (
  run_id TEXT NOT NULL,
  sample_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  observed_at_ms INTEGER NOT NULL,
  invariants_json TEXT NOT NULL,
  PRIMARY KEY (run_id, sample_id)
);

CREATE INDEX IF NOT EXISTS idx_burn_in_samples_run ON burn_in_samples (run_id, sequence);
