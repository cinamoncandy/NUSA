import {
  OrderSubmissionStatus,
  isAllowedTransition,
  type OrderExecutionRecord,
  type OrderExecutionStatusRepository
} from "../../../apps/execution/src/execution-gateway";
import type { SqliteDatabase } from "./index";

type SqlRow = Record<string, string | number | bigint | null>;

function asString(value: string | number | bigint | null): string {
  return String(value);
}

function decode(row: SqlRow): OrderExecutionRecord {
  return Object.freeze({
    executionId: asString(row.execution_id),
    intentId: asString(row.intent_id),
    idempotencyKey: asString(row.idempotency_key),
    payloadHash: asString(row.payload_hash),
    status: asString(row.status) as OrderSubmissionStatus,
    providerOrderId: row.provider_order_id == null ? undefined : asString(row.provider_order_id),
    reason: row.reason == null ? undefined : asString(row.reason),
    createdAtMs: Number(asString(row.created_at_ms)),
    updatedAtMs: Number(asString(row.updated_at_ms))
  });
}

export class SqliteOrderExecutionRepository implements OrderExecutionStatusRepository {
  public constructor(private readonly db: SqliteDatabase) {
    this.db.connection.exec(`
      CREATE TABLE IF NOT EXISTS order_execution_records (
        execution_id TEXT PRIMARY KEY,
        intent_id TEXT NOT NULL UNIQUE,
        idempotency_key TEXT NOT NULL UNIQUE,
        payload_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('SUBMITTING', 'ACCEPTED', 'REJECTED', 'SUBMISSION_UNKNOWN')),
        provider_order_id TEXT,
        reason TEXT,
        created_at_ms TEXT NOT NULL,
        updated_at_ms TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_order_execution_status_updated
        ON order_execution_records (status, updated_at_ms);
    `);
  }

  public getByIntentId(intentId: string): OrderExecutionRecord | undefined {
    const row = this.db.connection
      .prepare("SELECT * FROM order_execution_records WHERE intent_id = ?")
      .get(intentId) as SqlRow | undefined;
    return row == null ? undefined : decode(row);
  }

  public getByExecutionId(executionId: string): OrderExecutionRecord | undefined {
    const row = this.db.connection
      .prepare("SELECT * FROM order_execution_records WHERE execution_id = ?")
      .get(executionId) as SqlRow | undefined;
    return row == null ? undefined : decode(row);
  }

  public listByStatus(status: OrderSubmissionStatus): readonly OrderExecutionRecord[] {
    const rows = this.db.connection
      .prepare("SELECT * FROM order_execution_records WHERE status = ? ORDER BY created_at_ms ASC, execution_id ASC")
      .all(status) as SqlRow[];
    return Object.freeze(rows.map(decode));
  }

  public save(record: OrderExecutionRecord): OrderExecutionRecord {
    return this.db.transaction(() => {
      const existing = this.getByIntentId(record.intentId);
      if (existing == null) {
        this.db.connection.prepare(`
          INSERT INTO order_execution_records (
            execution_id, intent_id, idempotency_key, payload_hash, status,
            provider_order_id, reason, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.executionId,
          record.intentId,
          record.idempotencyKey,
          record.payloadHash,
          record.status,
          record.providerOrderId ?? null,
          record.reason ?? null,
          record.createdAtMs.toString(),
          record.updatedAtMs.toString()
        );
      } else {
        if (existing.executionId !== record.executionId) {
          throw new Error("intent already belongs to another execution");
        }
        if (
          existing.idempotencyKey !== record.idempotencyKey
          || existing.payloadHash !== record.payloadHash
          || existing.createdAtMs !== record.createdAtMs
        ) {
          throw new Error("execution identity cannot be changed");
        }
        if (!isAllowedTransition(existing.status, record.status)) {
          throw new Error("execution status transition is not allowed");
        }
        if (record.updatedAtMs < existing.updatedAtMs) {
          throw new Error("execution update time cannot regress");
        }
        this.db.connection.prepare(`
          UPDATE order_execution_records
          SET status = ?, provider_order_id = ?, reason = ?, updated_at_ms = ?
          WHERE execution_id = ?
        `).run(
          record.status,
          record.providerOrderId ?? null,
          record.reason ?? null,
          record.updatedAtMs.toString(),
          record.executionId
        );
      }
      const stored = this.getByIntentId(record.intentId);
      if (stored == null) throw new Error("execution record did not persist");
      return stored;
    });
  }

  public recoverUncertainSubmissions(nowMs: number, reason = "process restarted before provider outcome was persisted"): readonly OrderExecutionRecord[] {
    this.db.connection.prepare(`
      UPDATE order_execution_records
      SET status = 'SUBMISSION_UNKNOWN', reason = ?, updated_at_ms = ?
      WHERE status = 'SUBMITTING'
    `).run(reason, nowMs.toString());
    return this.listByStatus(OrderSubmissionStatus.SUBMISSION_UNKNOWN);
  }

  public list(): readonly OrderExecutionRecord[] {
    const rows = this.db.connection
      .prepare("SELECT * FROM order_execution_records ORDER BY created_at_ms ASC, execution_id ASC")
      .all() as SqlRow[];
    return Object.freeze(rows.map(decode));
  }
}
