CREATE TABLE IF NOT EXISTS liquidation_risk_assessments (
  assessment_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  status TEXT NOT NULL,
  equity_raw TEXT NOT NULL,
  margin_ratio_ppm TEXT,
  observed_at_ms TEXT NOT NULL,
  restriction_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_liquidation_risk_latest
  ON liquidation_risk_assessments(account_id, symbol, observed_at_ms, assessment_id);
