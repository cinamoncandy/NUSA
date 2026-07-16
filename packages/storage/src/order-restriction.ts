import type {
  OrderOperationalRestriction,
  OrderOperationalRestrictionRepository
} from "../../../apps/execution/src/order-restriction";
import type { SqliteDatabase } from "./index";

type SqlRow = Record<string, string | number | bigint | null>;

function decode(row: SqlRow): OrderOperationalRestriction {
  return Object.freeze({
    restrictionId: String(row.restriction_id),
    accountId: String(row.account_id),
    reason: String(row.reason) as OrderOperationalRestriction["reason"],
    sourceRunId: String(row.source_run_id),
    sourceIntentIds: Object.freeze(JSON.parse(String(row.source_intent_ids_json)) as string[]),
    blockNewExposure: true,
    manualReleaseRequired: true,
    status: String(row.status) as OrderOperationalRestriction["status"],
    createdAtMs: Number(String(row.created_at_ms)),
    releasedAtMs: row.released_at_ms == null ? undefined : Number(String(row.released_at_ms))
  });
}

export class SqliteOrderOperationalRestrictionRepository implements OrderOperationalRestrictionRepository {
  public constructor(private readonly db: SqliteDatabase) {
    this.db.connection.exec(`
      CREATE TABLE IF NOT EXISTS order_operational_restrictions (
        restriction_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        reason TEXT NOT NULL CHECK (reason IN ('CRITICAL_UNKNOWN_SUBMISSION')),
        source_run_id TEXT NOT NULL,
        source_intent_ids_json TEXT NOT NULL,
        block_new_exposure INTEGER NOT NULL CHECK (block_new_exposure = 1),
        manual_release_required INTEGER NOT NULL CHECK (manual_release_required = 1),
        status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'RELEASED')),
        created_at_ms TEXT NOT NULL,
        released_at_ms TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_order_operational_restrictions_active_account
        ON order_operational_restrictions (account_id)
        WHERE status = 'ACTIVE';
    `);
  }

  public getById(restrictionId: string): OrderOperationalRestriction | undefined {
    const row = this.db.connection
      .prepare("SELECT * FROM order_operational_restrictions WHERE restriction_id = ?")
      .get(restrictionId) as SqlRow | undefined;
    return row == null ? undefined : decode(row);
  }

  public getActiveForAccount(accountId: string): OrderOperationalRestriction | undefined {
    const row = this.db.connection
      .prepare("SELECT * FROM order_operational_restrictions WHERE account_id = ? AND status = 'ACTIVE'")
      .get(accountId) as SqlRow | undefined;
    return row == null ? undefined : decode(row);
  }

  public save(restriction: OrderOperationalRestriction): OrderOperationalRestriction {
    const existing = this.db.connection
      .prepare("SELECT * FROM order_operational_restrictions WHERE restriction_id = ?")
      .get(restriction.restrictionId) as SqlRow | undefined;
    if (existing == null) {
      this.db.connection.prepare(`
        INSERT INTO order_operational_restrictions (
          restriction_id, account_id, reason, source_run_id, source_intent_ids_json,
          block_new_exposure, manual_release_required, status, created_at_ms, released_at_ms
        ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?)
      `).run(
        restriction.restrictionId,
        restriction.accountId,
        restriction.reason,
        restriction.sourceRunId,
        JSON.stringify([...restriction.sourceIntentIds].sort()),
        restriction.status,
        restriction.createdAtMs.toString(),
        restriction.releasedAtMs?.toString() ?? null
      );
    } else {
      const previous = decode(existing);
      if (previous.accountId !== restriction.accountId || previous.reason !== restriction.reason || previous.sourceRunId !== restriction.sourceRunId) {
        throw new Error("restriction identity cannot be changed");
      }
      if (previous.status === "RELEASED" && restriction.status !== "RELEASED") {
        throw new Error("released restriction cannot be reactivated");
      }
      this.db.connection.prepare(`
        UPDATE order_operational_restrictions
        SET status = ?, released_at_ms = ?
        WHERE restriction_id = ?
      `).run(restriction.status, restriction.releasedAtMs?.toString() ?? null, restriction.restrictionId);
    }
    return this.getById(restriction.restrictionId)!;
  }
}
