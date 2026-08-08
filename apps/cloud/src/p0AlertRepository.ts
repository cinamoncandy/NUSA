import type { SqliteDatabase } from "../../../packages/storage/src/index";
import { appendP0AlertEvent, replayP0AlertLedger, type P0AlertEvent, type P0AlertRecord, type ReplayedP0AlertState } from "./p0AlertLedger";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS cloud_p0_alert_events (
  sequence INTEGER PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  incident_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('OPENED','RESOLVED')),
  occurred_at INTEGER NOT NULL,
  reason TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_cloud_p0_alert_incident ON cloud_p0_alert_events (incident_id, sequence);
`;

type Row = Readonly<Record<string, string | number | bigint | null>>;

const decode = (row: Row): P0AlertRecord => Object.freeze({
  sequence: Number(row.sequence),
  previousHash: String(row.previous_hash),
  event: Object.freeze({
    eventId: String(row.event_id),
    incidentId: String(row.incident_id),
    type: String(row.event_type) as P0AlertEvent["type"],
    occurredAt: Number(row.occurred_at),
    reason: String(row.reason)
  }),
  hash: String(row.hash)
});

/**
 * Durable, append-only P0 safety state. Schema creation is intentionally owned by this bounded
 * repository so the safety reader cannot silently fall back to an in-memory or "no alert" state.
 * Every read replays and verifies the complete hash chain; corruption therefore fails closed.
 */
export class SqliteP0AlertRepository {
  public constructor(private readonly db: SqliteDatabase) {
    this.db.transaction(() => this.db.connection.exec(SCHEMA_SQL));
  }

  public loadAll(): readonly P0AlertRecord[] {
    const rows = this.db.connection.prepare("SELECT * FROM cloud_p0_alert_events ORDER BY sequence ASC").all() as Row[];
    const records = Object.freeze(rows.map(decode));
    replayP0AlertLedger(records);
    return records;
  }

  public readState(): ReplayedP0AlertState {
    return replayP0AlertLedger(this.loadAll());
  }

  public append(event: P0AlertEvent): P0AlertRecord {
    return this.db.transaction(() => {
      const records = this.loadAll();
      const next = appendP0AlertEvent(records, event);
      const record = next[next.length - 1];
      this.db.connection.prepare(`
        INSERT INTO cloud_p0_alert_events
          (sequence, event_id, incident_id, event_type, occurred_at, reason, previous_hash, hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.sequence,
        record.event.eventId,
        record.event.incidentId,
        record.event.type,
        record.event.occurredAt,
        record.event.reason,
        record.previousHash,
        record.hash
      );
      replayP0AlertLedger(this.loadAll());
      return record;
    });
  }
}
