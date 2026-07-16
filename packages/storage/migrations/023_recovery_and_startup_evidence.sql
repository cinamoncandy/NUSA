CREATE TABLE IF NOT EXISTS disaster_recovery_runs (
  run_id TEXT PRIMARY KEY,
  decision TEXT NOT NULL CHECK (decision IN ('CONSISTENT','SAFE_BLOCK')),
  domains_json TEXT NOT NULL,
  blocking_domains_json TEXT NOT NULL,
  completed_at_ms TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS startup_gate_audits (
  audit_id TEXT PRIMARY KEY,
  recovery_run_id TEXT NOT NULL UNIQUE,
  decision TEXT NOT NULL CHECK (decision IN ('ALLOW_RESTRICTED_START','BLOCK_START')),
  blockers_json TEXT NOT NULL,
  evaluated_at_ms TEXT NOT NULL,
  production_mutation_allowed INTEGER NOT NULL CHECK (production_mutation_allowed = 0),
  FOREIGN KEY (recovery_run_id) REFERENCES disaster_recovery_runs(run_id)
);
