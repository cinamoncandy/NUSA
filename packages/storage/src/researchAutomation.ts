import { createHash } from "node:crypto";
import type { ResearchSessionRecord, ResearchSessionRepository, ResearchSessionState } from "../../contracts/src/researchAutomation";
import { canonicalResearchJson } from "../../contracts/src/researchRuntime";

export interface ResearchAutomationDatabase {
  readonly connection: { prepare(sql: string): { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[]; run(...params: unknown[]): unknown } };
  transaction<T>(fn: () => T): T;
}

const states = new Set<ResearchSessionState>(["IDLE", "RUNNING", "PAUSED", "HALTED", "COMPLETED", "FAILED"]);
const hash = (value: unknown): string => createHash("sha256").update(canonicalResearchJson(value), "utf8").digest("hex");
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function validate(record: ResearchSessionRecord): void {
  for (const [field, value] of Object.entries({
    sessionId: record.sessionId,
    datasetId: record.datasetId,
    interval: record.interval,
    championStrategyId: record.championStrategyId,
    championStrategyVersion: record.championStrategyVersion,
    challengerStrategyId: record.challengerStrategyId,
    challengerStrategyVersion: record.challengerStrategyVersion,
    deterministicConfigHash: record.deterministicConfigHash
  })) if (typeof value !== "string" || value.trim() === "") throw new Error(`research session ${field} is invalid`);
  if (record.hypothesisId != null && (typeof record.hypothesisId !== "string" || record.hypothesisId.trim() === "")) throw new Error("research session hypothesis reference is invalid");
  if (!states.has(record.state) || !positiveInteger(record.maxExperiments) || !Number.isSafeInteger(record.experimentCount) || record.experimentCount < 0 || record.experimentCount !== record.evaluationIds.length || record.experimentCount > record.maxExperiments) throw new Error("research session bounds are invalid");
  if (!Number.isSafeInteger(record.startedAt) || !Number.isSafeInteger(record.updatedAt) || record.updatedAt < record.startedAt) throw new Error("research session timestamps are invalid");
  if (new Set(record.evaluationIds).size !== record.evaluationIds.length || record.evaluationIds.some((id) => typeof id !== "string" || id.trim() === "")) throw new Error("research session evaluation identity is invalid");
  const metrics = record.metrics;
  if (metrics.experimentCount !== record.experimentCount || !Number.isSafeInteger(metrics.experimentCount) || metrics.experimentCount < 0 || !Number.isSafeInteger(metrics.positiveEvaluationCount) || !Number.isSafeInteger(metrics.negativeEvaluationCount) || !Number.isSafeInteger(metrics.championBetterCount) || !Number.isSafeInteger(metrics.challengerBetterCount) || !Number.isSafeInteger(metrics.equivalentCount) || !Number.isSafeInteger(metrics.inconclusiveCount) || !finite(metrics.cumulativeNetReturn) || !finite(metrics.averageNetReturn) || (metrics.costAdjustedPerformance != null && !finite(metrics.costAdjustedPerformance))) throw new Error("research session metrics are invalid");
  for (const value of [metrics.costAdjustedEvidenceCount, metrics.missingCostEvidenceCount]) if (value != null && (!Number.isSafeInteger(value) || value < 0)) throw new Error("research session cost evidence counts are invalid");
  if (metrics.costAdjustedEvidenceCount != null && metrics.missingCostEvidenceCount != null && metrics.costAdjustedEvidenceCount + metrics.missingCostEvidenceCount !== record.experimentCount) throw new Error("research session cost evidence counts do not reconcile");
  if (metrics.maxDrawdown != null && !finite(metrics.maxDrawdown)) throw new Error("research session drawdown is invalid");
}

function decode(payload: string, checksum: string): ResearchSessionRecord {
  let record: ResearchSessionRecord;
  try { record = JSON.parse(payload) as ResearchSessionRecord; } catch { throw new Error("research session payload is corrupted"); }
  if (hash(record) !== checksum) throw new Error("research session checksum mismatch");
  validate(record);
  return Object.freeze({ ...record, evaluationIds: Object.freeze([...record.evaluationIds]), metrics: Object.freeze({ ...record.metrics }) });
}

export class SqliteResearchSessionRepository implements ResearchSessionRepository {
  public constructor(private readonly db: ResearchAutomationDatabase) {}

  public save(record: ResearchSessionRecord): ResearchSessionRecord {
    validate(record);
    const payload = JSON.stringify(record);
    const checksum = hash(record);
    return this.db.transaction(() => {
      this.db.connection.prepare("INSERT INTO research_sessions (session_id, state, payload_json, checksum, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET state = excluded.state, payload_json = excluded.payload_json, checksum = excluded.checksum, updated_at = excluded.updated_at").run(record.sessionId, record.state, payload, checksum, record.updatedAt);
      const stored = this.load(record.sessionId);
      if (stored == null) throw new Error("research session did not persist");
      return stored;
    });
  }

  public load(sessionId: string): ResearchSessionRecord | undefined {
    const row = this.db.connection.prepare("SELECT payload_json, checksum FROM research_sessions WHERE session_id = ?").get(sessionId) as { payload_json: string; checksum: string } | undefined;
    return row == null ? undefined : decode(row.payload_json, row.checksum);
  }

  public list(): readonly ResearchSessionRecord[] {
    const rows = this.db.connection.prepare("SELECT payload_json, checksum FROM research_sessions ORDER BY session_id ASC").all() as Array<{ payload_json: string; checksum: string }>;
    return Object.freeze(rows.map((row) => decode(row.payload_json, row.checksum)));
  }
}
