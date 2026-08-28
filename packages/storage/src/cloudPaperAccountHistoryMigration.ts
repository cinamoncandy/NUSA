import type { SqliteMigration } from "./migrationRunner";

/**
 * Canonical PAPER account history migration. This preserves historical versions of the
 * existing `cloud_paper_accounts` row. It does not create another PAPER engine or evidence
 * authority; it only makes the canonical account snapshots restart-recoverable.
 */
export const cloudPaperAccountHistoryMigration: SqliteMigration = Object.freeze({
  id: "018_cloud_paper_account_history",
  sql: `
CREATE TABLE IF NOT EXISTS cloud_paper_account_history (
  account_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  PRIMARY KEY (account_id, updated_at)
);
CREATE INDEX IF NOT EXISTS idx_cloud_paper_account_history_time
  ON cloud_paper_account_history (account_id, updated_at ASC);

CREATE TRIGGER IF NOT EXISTS trg_cloud_paper_account_history_insert
AFTER INSERT ON cloud_paper_accounts
WHEN NEW.status = 'VALID'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM cloud_paper_account_history
    WHERE account_id = NEW.account_id AND updated_at > NEW.updated_at
  ) THEN RAISE(ABORT, 'PAPER_ACCOUNT_HISTORY_CHRONOLOGY_REGRESSION') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM cloud_paper_account_history
    WHERE account_id = NEW.account_id AND updated_at = NEW.updated_at
      AND (checksum <> NEW.checksum OR state_json <> NEW.state_json OR schema_version <> NEW.schema_version)
  ) THEN RAISE(ABORT, 'PAPER_ACCOUNT_HISTORY_IDENTITY_CONFLICT') END;
  INSERT INTO cloud_paper_account_history (account_id, schema_version, updated_at, state_json, checksum)
  SELECT NEW.account_id, NEW.schema_version, NEW.updated_at, NEW.state_json, NEW.checksum
  WHERE NOT EXISTS (
    SELECT 1 FROM cloud_paper_account_history
    WHERE account_id = NEW.account_id AND updated_at = NEW.updated_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_cloud_paper_account_history_update
AFTER UPDATE OF schema_version, updated_at, state_json, checksum, status ON cloud_paper_accounts
WHEN NEW.status = 'VALID'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM cloud_paper_account_history
    WHERE account_id = NEW.account_id AND updated_at > NEW.updated_at
  ) THEN RAISE(ABORT, 'PAPER_ACCOUNT_HISTORY_CHRONOLOGY_REGRESSION') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM cloud_paper_account_history
    WHERE account_id = NEW.account_id AND updated_at = NEW.updated_at
      AND (checksum <> NEW.checksum OR state_json <> NEW.state_json OR schema_version <> NEW.schema_version)
  ) THEN RAISE(ABORT, 'PAPER_ACCOUNT_HISTORY_IDENTITY_CONFLICT') END;
  INSERT INTO cloud_paper_account_history (account_id, schema_version, updated_at, state_json, checksum)
  SELECT NEW.account_id, NEW.schema_version, NEW.updated_at, NEW.state_json, NEW.checksum
  WHERE NOT EXISTS (
    SELECT 1 FROM cloud_paper_account_history
    WHERE account_id = NEW.account_id AND updated_at = NEW.updated_at
  );
END;

INSERT OR IGNORE INTO cloud_paper_account_history (account_id, schema_version, updated_at, state_json, checksum)
SELECT account_id, schema_version, updated_at, state_json, checksum
FROM cloud_paper_accounts
WHERE status = 'VALID';
`,
});
