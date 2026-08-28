import { createHash } from "node:crypto";
import type { SqliteDatabase } from "../../../packages/storage/src/index";
import type { PaperAccountState } from "./paperTradingExecutionLoop";

const HISTORY_TABLE = "cloud_paper_account_history";
const ACCOUNT_TABLE = "cloud_paper_accounts";
const ACCOUNT_ID = "paper-default";

export interface CanonicalPaperAccountSnapshot {
  readonly accountId: string;
  readonly schemaVersion: number;
  readonly updatedAt: number;
  readonly state: PaperAccountState;
  readonly checksum: string;
}

export class CanonicalPaperAccountSnapshotHistoryError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CanonicalPaperAccountSnapshotHistoryError";
  }
}

const digest = (payload: string): string => createHash("sha256").update(payload, "utf8").digest("hex");
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

/**
 * Installs append-only history capture around the existing canonical PAPER account row.
 * This does not create a second PAPER engine or evidence authority: it preserves historical
 * versions of the same canonical `cloud_paper_accounts` state so restart reconciliation can
 * recover exact period boundary snapshots instead of relying on the latest upsert alone.
 */
export class CanonicalPaperAccountSnapshotHistory {
  public constructor(private readonly db: SqliteDatabase) {
    this.db.connection.exec(`
      CREATE TABLE IF NOT EXISTS ${HISTORY_TABLE} (
        account_id TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        checksum TEXT NOT NULL,
        PRIMARY KEY (account_id, updated_at)
      );
      CREATE INDEX IF NOT EXISTS idx_cloud_paper_account_history_time
        ON ${HISTORY_TABLE} (account_id, updated_at ASC);

      CREATE TRIGGER IF NOT EXISTS trg_cloud_paper_account_history_insert
      AFTER INSERT ON ${ACCOUNT_TABLE}
      WHEN NEW.status = 'VALID'
      BEGIN
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM ${HISTORY_TABLE}
          WHERE account_id = NEW.account_id AND updated_at = NEW.updated_at
            AND (checksum <> NEW.checksum OR state_json <> NEW.state_json OR schema_version <> NEW.schema_version)
        ) THEN RAISE(ABORT, 'PAPER_ACCOUNT_HISTORY_IDENTITY_CONFLICT') END;
        INSERT OR IGNORE INTO ${HISTORY_TABLE} (account_id, schema_version, updated_at, state_json, checksum)
        VALUES (NEW.account_id, NEW.schema_version, NEW.updated_at, NEW.state_json, NEW.checksum);
      END;

      CREATE TRIGGER IF NOT EXISTS trg_cloud_paper_account_history_update
      AFTER UPDATE OF schema_version, updated_at, state_json, checksum, status ON ${ACCOUNT_TABLE}
      WHEN NEW.status = 'VALID'
      BEGIN
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM ${HISTORY_TABLE}
          WHERE account_id = NEW.account_id AND updated_at = NEW.updated_at
            AND (checksum <> NEW.checksum OR state_json <> NEW.state_json OR schema_version <> NEW.schema_version)
        ) THEN RAISE(ABORT, 'PAPER_ACCOUNT_HISTORY_IDENTITY_CONFLICT') END;
        INSERT OR IGNORE INTO ${HISTORY_TABLE} (account_id, schema_version, updated_at, state_json, checksum)
        VALUES (NEW.account_id, NEW.schema_version, NEW.updated_at, NEW.state_json, NEW.checksum);
      END;
    `);

    // Preserve the current canonical state when history is installed after an existing account.
    this.db.connection.prepare(`
      INSERT OR IGNORE INTO ${HISTORY_TABLE} (account_id, schema_version, updated_at, state_json, checksum)
      SELECT account_id, schema_version, updated_at, state_json, checksum
      FROM ${ACCOUNT_TABLE}
      WHERE account_id = ? AND status = 'VALID'
    `).run(ACCOUNT_ID);
  }

  public list(): readonly CanonicalPaperAccountSnapshot[] {
    const rows = this.db.connection.prepare(`
      SELECT account_id, schema_version, updated_at, state_json, checksum
      FROM ${HISTORY_TABLE}
      WHERE account_id = ?
      ORDER BY updated_at ASC
    `).all(ACCOUNT_ID) as Array<Record<string, unknown>>;

    const seen = new Set<number>();
    return freeze(rows.map((row) => {
      const accountId = String(row.account_id ?? "");
      const schemaVersion = Number(row.schema_version);
      const updatedAt = Number(row.updated_at);
      const stateJson = String(row.state_json ?? "");
      const checksum = String(row.checksum ?? "");
      if (accountId !== ACCOUNT_ID || schemaVersion !== 1 || !Number.isSafeInteger(updatedAt) || updatedAt < 0 || seen.has(updatedAt)) {
        throw new CanonicalPaperAccountSnapshotHistoryError("INVALID_HISTORY_IDENTITY", "canonical PAPER account history identity is invalid");
      }
      seen.add(updatedAt);
      if (digest(stateJson) !== checksum) {
        throw new CanonicalPaperAccountSnapshotHistoryError("HISTORY_CHECKSUM_MISMATCH", "canonical PAPER account history checksum mismatch");
      }
      let state: PaperAccountState;
      try {
        state = JSON.parse(stateJson) as PaperAccountState;
      } catch {
        throw new CanonicalPaperAccountSnapshotHistoryError("MALFORMED_HISTORY_STATE", "canonical PAPER account history state is malformed");
      }
      if (state.version !== 1 || state.updatedAt !== updatedAt) {
        throw new CanonicalPaperAccountSnapshotHistoryError("HISTORY_STATE_IDENTITY_MISMATCH", "canonical PAPER account history state does not match row identity");
      }
      return freeze({ accountId, schemaVersion, updatedAt, state: freeze(state), checksum });
    }));
  }
}
