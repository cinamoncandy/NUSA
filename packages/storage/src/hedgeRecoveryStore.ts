import type { DatabaseSync } from "node:sqlite";
import type { HedgeRecoveryRecord, ReplayedHedgeRecoveryState } from "../../../apps/cloud/src/hedgeRecoveryLedger";

export interface HedgeRecoveryDatabase {
  readonly connection: DatabaseSync;
  transaction<T>(fn: () => T): T;
}

const SHA256 = /^[a-f0-9]{64}$/;

export class SqliteHedgeRecoveryStore {
  public constructor(private readonly db: HedgeRecoveryDatabase) {
    this.db.connection.exec(`
      CREATE TABLE IF NOT EXISTS hedge_recovery_records (
        hedge_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        previous_hash TEXT NOT NULL,
        event_json TEXT NOT NULL,
        hash TEXT NOT NULL UNIQUE,
        PRIMARY KEY (hedge_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS hedge_recovery_state (
        hedge_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        actual_delta REAL NOT NULL,
        kill_switch_recommended INTEGER NOT NULL,
        last_recorded_at INTEGER NOT NULL,
        ledger_hash TEXT NOT NULL
      );
    `);
  }

  public list(hedgeId: string): readonly HedgeRecoveryRecord[] {
    const id = hedgeId.trim();
    if (!id) throw new Error("hedgeId is required");
    const rows = this.db.connection.prepare("SELECT * FROM hedge_recovery_records WHERE hedge_id = ? ORDER BY sequence ASC").all(id) as Record<string, unknown>[];
    return Object.freeze(rows.map((row) => {
      let event: unknown;
      try { event = JSON.parse(String(row.event_json)); } catch { throw new Error("stored hedge recovery event is invalid JSON"); }
      return Object.freeze({
        sequence: Number(row.sequence),
        previousHash: String(row.previous_hash),
        event: Object.freeze({ ...(event as HedgeRecoveryRecord["event"]) }),
        hash: String(row.hash)
      });
    }));
  }

  public loadState(hedgeId: string): ReplayedHedgeRecoveryState | undefined {
    const row = this.db.connection.prepare("SELECT * FROM hedge_recovery_state WHERE hedge_id = ?").get(hedgeId.trim()) as Record<string, unknown> | undefined;
    if (row == null) return undefined;
    const ledgerHash = String(row.ledger_hash);
    if (!SHA256.test(ledgerHash)) throw new Error("stored hedge recovery ledger hash is invalid");
    return Object.freeze({
      hedgeId: String(row.hedge_id),
      status: String(row.status) as ReplayedHedgeRecoveryState["status"],
      actualDelta: Number(row.actual_delta),
      killSwitchRecommended: Number(row.kill_switch_recommended) === 1,
      lastRecordedAt: Number(row.last_recorded_at),
      ledgerHash
    });
  }

  public appendAndSave(record: HedgeRecoveryRecord, state: ReplayedHedgeRecoveryState): ReplayedHedgeRecoveryState {
    return this.db.transaction(() => {
      if (state.hedgeId == null || state.status == null || state.lastRecordedAt == null) throw new Error("hedge recovery state is incomplete");
      if (!SHA256.test(record.previousHash) || !SHA256.test(record.hash)) throw new Error("hedge recovery record hash is invalid");
      const existing = this.loadState(state.hedgeId);
      const expectedSequence = Number((this.db.connection.prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM hedge_recovery_records WHERE hedge_id = ?").get(state.hedgeId) as Record<string, unknown>).sequence) + 1;
      const expectedPreviousHash = existing?.ledgerHash ?? "0".repeat(64);
      if (record.sequence !== expectedSequence) throw new Error("hedge recovery sequence conflict");
      if (record.previousHash !== expectedPreviousHash) throw new Error("hedge recovery previous hash conflict");
      if (record.event.hedgeId !== state.hedgeId || record.hash !== state.ledgerHash) throw new Error("hedge recovery state does not match record");

      this.db.connection.prepare("INSERT INTO hedge_recovery_records (hedge_id, sequence, previous_hash, event_json, hash) VALUES (?, ?, ?, ?, ?)")
        .run(state.hedgeId, record.sequence, record.previousHash, JSON.stringify(record.event), record.hash);
      this.db.connection.prepare(`
        INSERT INTO hedge_recovery_state (hedge_id, status, actual_delta, kill_switch_recommended, last_recorded_at, ledger_hash)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(hedge_id) DO UPDATE SET
          status = excluded.status,
          actual_delta = excluded.actual_delta,
          kill_switch_recommended = excluded.kill_switch_recommended,
          last_recorded_at = excluded.last_recorded_at,
          ledger_hash = excluded.ledger_hash
      `).run(state.hedgeId, state.status, state.actualDelta, state.killSwitchRecommended ? 1 : 0, state.lastRecordedAt, state.ledgerHash);

      const stored = this.loadState(state.hedgeId);
      if (stored == null || stored.ledgerHash !== record.hash) throw new Error("hedge recovery write did not persist");
      return stored;
    });
  }
}
