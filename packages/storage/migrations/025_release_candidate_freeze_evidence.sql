CREATE TABLE IF NOT EXISTS release_candidate_freeze_evidence (
  candidate_id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  blockers_json TEXT NOT NULL,
  frozen_head_sha TEXT NOT NULL,
  artifact_manifest_hash TEXT NOT NULL,
  production_mutation_allowed INTEGER NOT NULL CHECK (production_mutation_allowed = 0),
  recorded_at_ms INTEGER NOT NULL
);
