CREATE TABLE IF NOT EXISTS evidence_graph_seals (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  seal_id TEXT NOT NULL UNIQUE,
  candidate_id TEXT NOT NULL,
  graph_hash TEXT NOT NULL,
  previous_seal_hash TEXT NOT NULL,
  chain_hash TEXT NOT NULL UNIQUE,
  node_count INTEGER NOT NULL,
  edge_count INTEGER NOT NULL,
  sealed_at_ms INTEGER NOT NULL,
  deployment_allowed INTEGER NOT NULL CHECK (deployment_allowed = 0),
  production_mutation_allowed INTEGER NOT NULL CHECK (production_mutation_allowed = 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_graph_seals_previous ON evidence_graph_seals (previous_seal_hash);
