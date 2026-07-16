import type { SqliteDatabase } from "./index";

export interface StoredOrderIdempotencyRecord {
  readonly key: string;
  readonly intentId: string;
  readonly payloadHash: string;
  readonly createdAtMs: number;
}

type SqlRow = Record<string, string | number | bigint | null>;

function asString(value: string | number | bigint | null): string {
  return String(value);
}

export class SqliteOrderIdempotencyRepository {
  public constructor(private readonly db: SqliteDatabase) {
    this.db.connection.exec(`
      CREATE TABLE IF NOT EXISTS order_idempotency_records (
        idempotency_key TEXT PRIMARY KEY,
        intent_id TEXT NOT NULL UNIQUE,
        payload_hash TEXT NOT NULL,
        created_at_ms TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_order_idempotency_created_at
        ON order_idempotency_records (created_at_ms);
    `);
  }

  public get(key: string): StoredOrderIdempotencyRecord | undefined {
    const row = this.db.connection
      .prepare("SELECT * FROM order_idempotency_records WHERE idempotency_key = ?")
      .get(key) as SqlRow | undefined;
    return row == null ? undefined : this.decode(row);
  }

  public findByIntent(intentId: string): StoredOrderIdempotencyRecord | undefined {
    const row = this.db.connection
      .prepare("SELECT * FROM order_idempotency_records WHERE intent_id = ?")
      .get(intentId) as SqlRow | undefined;
    return row == null ? undefined : this.decode(row);
  }

  public save(record: StoredOrderIdempotencyRecord): void {
    this.db.connection.prepare(`
      INSERT INTO order_idempotency_records (
        idempotency_key, intent_id, payload_hash, created_at_ms
      ) VALUES (?, ?, ?, ?)
    `).run(record.key, record.intentId, record.payloadHash, record.createdAtMs.toString());
  }

  public list(): readonly StoredOrderIdempotencyRecord[] {
    const rows = this.db.connection
      .prepare("SELECT * FROM order_idempotency_records ORDER BY created_at_ms ASC, idempotency_key ASC")
      .all() as SqlRow[];
    return Object.freeze(rows.map(row => this.decode(row)));
  }

  private decode(row: SqlRow): StoredOrderIdempotencyRecord {
    return Object.freeze({
      key: asString(row.idempotency_key),
      intentId: asString(row.intent_id),
      payloadHash: asString(row.payload_hash),
      createdAtMs: Number(asString(row.created_at_ms))
    });
  }
}
