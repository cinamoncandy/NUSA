import type {
  PositionReconciliationRunEvidence,
  PositionReconciliationRunEvidenceRepository
} from "../../../apps/execution/src/position-reconciliation-worker";
import type { SqliteDatabase } from "./index";

type SqlRow = Record<string, string | number | bigint | null>;

function decode(row: SqlRow): PositionReconciliationRunEvidence {
  return Object.freeze({
    runId: String(row.run_id),
    startedAtMs: Number(String(row.started_at_ms)),
    scannedCount: Number(row.scanned_count),
    matchedCount: Number(row.matched_count),
    mismatchCount: Number(row.mismatch_count),
    unavailableCount: Number(row.unavailable_count),
    restrictionCount: Number(row.restriction_count),
    truncated: Number(row.truncated) === 1,
    reconciliationIds: Object.freeze(JSON.parse(String(row.reconciliation_ids_json)) as string[])
  });
}

export class SqlitePositionReconciliationRunEvidenceRepository implements PositionReconciliationRunEvidenceRepository {
  public constructor(private readonly db: SqliteDatabase) {
    this.db.connection.exec(`
      CREATE TABLE IF NOT EXISTS position_reconciliation_runs (
        run_id TEXT PRIMARY KEY,
        started_at_ms TEXT NOT NULL,
        scanned_count INTEGER NOT NULL,
        matched_count INTEGER NOT NULL,
        mismatch_count INTEGER NOT NULL,
        unavailable_count INTEGER NOT NULL,
        restriction_count INTEGER NOT NULL,
        truncated INTEGER NOT NULL CHECK (truncated IN (0, 1)),
        reconciliation_ids_json TEXT NOT NULL
      );
    `);
  }

  public append(run: PositionReconciliationRunEvidence): PositionReconciliationRunEvidence {
    this.db.connection.prepare(`
      INSERT INTO position_reconciliation_runs (
        run_id, started_at_ms, scanned_count, matched_count, mismatch_count,
        unavailable_count, restriction_count, truncated, reconciliation_ids_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.runId,
      run.startedAtMs.toString(),
      run.scannedCount,
      run.matchedCount,
      run.mismatchCount,
      run.unavailableCount,
      run.restrictionCount,
      run.truncated ? 1 : 0,
      JSON.stringify([...run.reconciliationIds])
    );
    return this.getById(run.runId)!;
  }

  public getById(runId: string): PositionReconciliationRunEvidence | undefined {
    const row = this.db.connection.prepare(
      "SELECT * FROM position_reconciliation_runs WHERE run_id = ?"
    ).get(runId) as SqlRow | undefined;
    return row == null ? undefined : decode(row);
  }
}
