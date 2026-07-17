CREATE TABLE IF NOT EXISTS burn_in_evidence (
  run_id TEXT PRIMARY KEY,
  decision TEXT NOT NULL,
  sample_count INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  critical_failure_samples INTEGER NOT NULL,
  unknown_samples INTEGER NOT NULL,
  blocking_reasons_json TEXT NOT NULL,
  final_invariant_status TEXT NOT NULL,
  completed_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS synthetic_certification_reports (
  report_id TEXT PRIMARY KEY,
  burn_in_run_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  blockers_json TEXT NOT NULL,
  limitations_json TEXT NOT NULL,
  generated_at_ms INTEGER NOT NULL,
  production_mutation_allowed INTEGER NOT NULL CHECK (production_mutation_allowed = 0),
  FOREIGN KEY (burn_in_run_id) REFERENCES burn_in_evidence(run_id)
);

CREATE INDEX IF NOT EXISTS idx_synthetic_certification_burn_in
  ON synthetic_certification_reports (burn_in_run_id, generated_at_ms);
