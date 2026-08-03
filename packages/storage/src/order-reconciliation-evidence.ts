import type {
  UnknownSubmissionReconciliationEvidenceRepository,
  UnknownSubmissionReconciliationRun
} from "../../../apps/execution/src/order-reconciliation";
import type { SqliteDatabase } from "./index";

type SqlRow = Record<string, string | number | bigint | null>;

export interface StoredOrderReconciliationRunSummary {
  readonly runId: string;
  readonly startedAtMs: number;
  readonly scannedCount: number;
  readonly resolvedCount: number;
  readonly unresolvedCount: number;
  readonly overdueCount: number;
  readonly criticalCount: number;
  readonly truncated: boolean;
  readonly nextCursor: string | undefined;
}

export interface StoredOrderReconciliationItem {
  readonly runId: string;
  readonly sequence: number;
  readonly intentId: string;
  readonly executionId: string;
  readonly ageMs: number;
  readonly ageStatus: string;
  readonly beforeStatus: string;
  readonly afterStatus: string;
  readonly resolved: boolean;
  readonly lookupStatus: string;
}

function asString(value: string | number | bigint | null): string {
  return String(value);
}

export class SqliteOrderReconciliationEvidenceRepository implements UnknownSubmissionReconciliationEvidenceRepository {
  public constructor(private readonly db: SqliteDatabase) {
    this.db.connection.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS order_reconciliation_runs (
        run_id TEXT PRIMARY KEY,
        started_at_ms TEXT NOT NULL,
        scanned_count INTEGER NOT NULL,
        resolved_count INTEGER NOT NULL,
        unresolved_count INTEGER NOT NULL,
        overdue_count INTEGER NOT NULL,
        critical_count INTEGER NOT NULL,
        truncated INTEGER NOT NULL CHECK (truncated IN (0, 1)),
        next_cursor TEXT
      );
      CREATE TABLE IF NOT EXISTS order_reconciliation_items (
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        intent_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        age_ms TEXT NOT NULL,
        age_status TEXT NOT NULL CHECK (age_status IN ('RECENT', 'OVERDUE', 'CRITICAL')),
        before_status TEXT NOT NULL,
        after_status TEXT NOT NULL,
        resolved INTEGER NOT NULL CHECK (resolved IN (0, 1)),
        lookup_status TEXT NOT NULL,
        PRIMARY KEY (run_id, sequence),
        FOREIGN KEY (run_id) REFERENCES order_reconciliation_runs(run_id)
      );
      CREATE INDEX IF NOT EXISTS idx_order_reconciliation_runs_started
        ON order_reconciliation_runs (started_at_ms, run_id);
      CREATE INDEX IF NOT EXISTS idx_order_reconciliation_items_intent
        ON order_reconciliation_items (intent_id, run_id);
    `);
  }

  public append(run: UnknownSubmissionReconciliationRun & { readonly runId: string }): void {
    if (run.runId.length === 0) throw new Error("reconciliation run id is required");
    this.db.transaction(() => {
      this.db.connection.prepare(`
        INSERT INTO order_reconciliation_runs (
          run_id, started_at_ms, scanned_count, resolved_count, unresolved_count,
          overdue_count, critical_count, truncated, next_cursor
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        run.runId,
        run.startedAtMs.toString(),
        run.scannedCount,
        run.resolvedCount,
        run.unresolvedCount,
        run.overdueCount,
        run.criticalCount,
        run.truncated ? 1 : 0,
        run.nextCursor ?? null
      );

      const insertItem = this.db.connection.prepare(`
        INSERT INTO order_reconciliation_items (
          run_id, sequence, intent_id, execution_id, age_ms, age_status,
          before_status, after_status, resolved, lookup_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      run.items.forEach((item, sequence) => {
        insertItem.run(
          run.runId,
          sequence,
          item.assessment.intentId,
          item.assessment.executionId,
          item.assessment.ageMs.toString(),
          item.assessment.ageStatus,
          item.reconciliation.before.status,
          item.reconciliation.after.status,
          item.reconciliation.resolved ? 1 : 0,
          item.reconciliation.lookupStatus
        );
      });
    });
  }

  public listRuns(): readonly StoredOrderReconciliationRunSummary[] {
    const rows = this.db.connection.prepare(`
      SELECT * FROM order_reconciliation_runs
      ORDER BY started_at_ms ASC, run_id ASC
    `).all() as SqlRow[];
    return Object.freeze(rows.map(row => Object.freeze({
      runId: asString(row.run_id),
      startedAtMs: Number(asString(row.started_at_ms)),
      scannedCount: Number(row.scanned_count),
      resolvedCount: Number(row.resolved_count),
      unresolvedCount: Number(row.unresolved_count),
      overdueCount: Number(row.overdue_count),
      criticalCount: Number(row.critical_count),
      truncated: Number(row.truncated) === 1,
      nextCursor: row.next_cursor == null ? undefined : String(row.next_cursor)
    })));
  }

  public listItems(runId: string): readonly StoredOrderReconciliationItem[] {
    const rows = this.db.connection.prepare(`
      SELECT * FROM order_reconciliation_items
      WHERE run_id = ?
      ORDER BY sequence ASC
    `).all(runId) as SqlRow[];
    return Object.freeze(rows.map(row => Object.freeze({
      runId: asString(row.run_id),
      sequence: Number(row.sequence),
      intentId: asString(row.intent_id),
      executionId: asString(row.execution_id),
      ageMs: Number(asString(row.age_ms)),
      ageStatus: asString(row.age_status),
      beforeStatus: asString(row.before_status),
      afterStatus: asString(row.after_status),
      resolved: Number(row.resolved) === 1,
      lookupStatus: asString(row.lookup_status)
    })));
  }
}
