import type { DatabaseSync } from "node:sqlite";
import { recordIsSelfConsistent, type AiEvaluationRecord } from "../../contracts/src/aiEvaluation";

/**
 * WO-039 persistence: append-only, version-preserving storage for AiEvaluationRecord.
 *
 * "평가 결과 저장/복원" and "평가 버전 관리" mean the same thing here: re-evaluating a
 * subject NEVER overwrites or deletes its prior evaluation. Every evaluation gets its
 * own row, keyed by evaluationId; a subject's history is every row for its subjectId,
 * oldest first. `latestForSubject` is a read convenience over that history, not a
 * separate mutable slot -- there is no UPDATE anywhere in this repository.
 */

type Row = { evaluation_id: string; subject_id: string; evaluated_at: string; record_json: string; record_sha256: string };
export interface AiEvaluationDatabase { readonly connection: DatabaseSync; }

export class AiEvaluationRepositoryError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AiEvaluationRepositoryError";
  }
}

export class SqliteAiEvaluationRepository {
  public constructor(private readonly db: AiEvaluationDatabase) {
    this.db.connection.exec(
      "CREATE TABLE IF NOT EXISTS ai_evaluation_records (" +
      "evaluation_id TEXT PRIMARY KEY, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, " +
      "evaluated_at TEXT NOT NULL, verdict TEXT NOT NULL, record_json TEXT NOT NULL, record_sha256 TEXT NOT NULL UNIQUE); " +
      "CREATE INDEX IF NOT EXISTS idx_ai_evaluation_subject ON ai_evaluation_records(subject_id, evaluated_at, evaluation_id);"
    );
  }

  /**
   * Rejects a record whose stored hash doesn't match its own content -- storing a
   * tampered or hand-edited record would make version history evidence in name only.
   */
  public append(record: AiEvaluationRecord): void {
    if (!record.evaluationId.trim() || !record.subjectId.trim()) throw new AiEvaluationRepositoryError("EMPTY_IDENTITY", "evaluationId and subjectId are required");
    if (!recordIsSelfConsistent(record)) throw new AiEvaluationRepositoryError("RECORD_HASH_MISMATCH", "record content does not match its declared recordSha256");
    try {
      this.db.connection
        .prepare("INSERT INTO ai_evaluation_records(evaluation_id,subject_type,subject_id,evaluated_at,verdict,record_json,record_sha256) VALUES(?,?,?,?,?,?,?)")
        .run(record.evaluationId, record.subjectType, record.subjectId, record.evaluatedAt, record.verdict, JSON.stringify(record), record.recordSha256);
    } catch (error) {
      throw new AiEvaluationRepositoryError("DUPLICATE_EVALUATION_ID", `evaluationId already recorded: ${record.evaluationId} (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  public getById(evaluationId: string): AiEvaluationRecord | undefined {
    const row = this.db.connection.prepare("SELECT * FROM ai_evaluation_records WHERE evaluation_id=?").get(evaluationId) as Row | undefined;
    return row === undefined ? undefined : (JSON.parse(row.record_json) as AiEvaluationRecord);
  }

  /** Full version history for one subject, oldest first. Nothing here is ever deleted. */
  public historyForSubject(subjectId: string): readonly AiEvaluationRecord[] {
    const rows = this.db.connection.prepare("SELECT * FROM ai_evaluation_records WHERE subject_id=? ORDER BY evaluated_at ASC, evaluation_id ASC").all(subjectId) as Row[];
    return Object.freeze(rows.map((row) => JSON.parse(row.record_json) as AiEvaluationRecord));
  }

  public latestForSubject(subjectId: string): AiEvaluationRecord | undefined {
    const row = this.db.connection.prepare("SELECT * FROM ai_evaluation_records WHERE subject_id=? ORDER BY evaluated_at DESC, evaluation_id DESC LIMIT 1").get(subjectId) as Row | undefined;
    return row === undefined ? undefined : (JSON.parse(row.record_json) as AiEvaluationRecord);
  }
}
