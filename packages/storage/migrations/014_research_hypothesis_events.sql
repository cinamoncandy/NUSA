CREATE TABLE IF NOT EXISTS research_hypothesis_events (
  sequence INTEGER PRIMARY KEY,
  hypothesis_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('CREATED','ACTIVATED','SUPPORTED','REJECTED','RETIRED')),
  title TEXT NOT NULL,
  statement TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_research_hypothesis_events_id ON research_hypothesis_events (hypothesis_id, sequence);
