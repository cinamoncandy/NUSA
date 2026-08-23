import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ImprovementDiagnosticEvidence } from "../../core/src/improvement/improvementTypes";

type Severity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type Recurrence = "NEW" | "RECURRING";
type Status = "OBSERVED" | "PENDING_REVIEW";

export interface ImprovementCandidateMemoryRecord {
  readonly id: string;
  readonly fingerprint: string;
  readonly type: "MARKET_RECONNECT_INSTABILITY";
  readonly source: "MarketConnectionSupervisor";
  readonly severity: Severity;
  readonly score: number;
  readonly occurrences: number;
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  readonly occurrenceTimestamps: readonly number[];
  readonly evidence?: readonly ImprovementDiagnosticEvidence[];
  readonly recurrence: Recurrence;
  readonly title: string;
  readonly status: Status;
}

export interface ImprovementCandidateMemoryDatabase {
  readonly connection: DatabaseSync;
  transaction<T>(fn: () => T): T;
}

const severities = new Set<Severity>(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const statuses = new Set<Status>(["OBSERVED", "PENDING_REVIEW"]);
const hash = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

function validate(record: ImprovementCandidateMemoryRecord): void {
  if (!record.fingerprint || record.id !== `candidate:${record.fingerprint}` || record.type !== "MARKET_RECONNECT_INSTABILITY" || record.source !== "MarketConnectionSupervisor") throw new Error("invalid improvement candidate identity");
  if (!severities.has(record.severity) || !statuses.has(record.status) || !["NEW", "RECURRING"].includes(record.recurrence)) throw new Error("invalid improvement candidate state");
  if (!Number.isSafeInteger(record.score) || record.score < 0 || !Number.isSafeInteger(record.occurrences) || record.occurrences < 1 || record.occurrenceTimestamps.length !== record.occurrences) throw new Error("invalid improvement candidate counts");
  if (record.occurrenceTimestamps.some((value, index) => !Number.isSafeInteger(value) || value < 0 || (index > 0 && value <= record.occurrenceTimestamps[index - 1]!))) throw new Error("invalid improvement candidate timestamps");
  if (record.firstSeenAt !== record.occurrenceTimestamps[0] || record.lastSeenAt !== record.occurrenceTimestamps[record.occurrenceTimestamps.length - 1] || record.recurrence !== (record.occurrences > 1 ? "RECURRING" : "NEW")) throw new Error("improvement candidate chronology is inconsistent");
  if (!record.title.trim()) throw new Error("improvement candidate title is required");
  for (const evidence of record.evidence ?? []) {
    if (typeof evidence.id !== "string" || evidence.fingerprint !== record.fingerprint || evidence.type !== record.type || evidence.source !== record.source || !Number.isSafeInteger(evidence.observedAt) || !record.occurrenceTimestamps.includes(evidence.observedAt)) throw new Error("invalid improvement candidate evidence");
  }
}

function normalized(record: ImprovementCandidateMemoryRecord): ImprovementCandidateMemoryRecord {
  return Object.freeze({ ...record, evidence: Object.freeze([...(record.evidence ?? [])].sort((left, right) => left.observedAt - right.observedAt || left.id.localeCompare(right.id))) });
}

function decode(row: Record<string, unknown>): ImprovementCandidateMemoryRecord {
  const payload = String(row.payload_json);
  if (hash(payload) !== String(row.checksum)) throw new Error("improvement candidate integrity violation");
  const record = JSON.parse(payload) as ImprovementCandidateMemoryRecord;
  const normalizedRecord = normalized(record);
  validate(normalizedRecord);
  return Object.freeze({ ...normalizedRecord, occurrenceTimestamps: Object.freeze([...normalizedRecord.occurrenceTimestamps]), evidence: Object.freeze([...(normalizedRecord.evidence ?? [])]) });
}

export class SqliteImprovementCandidateMemory {
  public constructor(private readonly db: ImprovementCandidateMemoryDatabase, private readonly maxRecords = 64) {
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) throw new Error("maxRecords must be a positive safe integer");
  }

  public load(): readonly ImprovementCandidateMemoryRecord[] {
    const rows = this.db.connection.prepare("SELECT payload_json, checksum FROM improvement_candidate_memory ORDER BY score DESC, last_seen_at ASC, fingerprint ASC").all() as Record<string, unknown>[];
    return Object.freeze(rows.map(decode));
  }

  public save(record: ImprovementCandidateMemoryRecord): void {
    const normalizedRecord = normalized(record);
    validate(normalizedRecord);
    const payload = JSON.stringify(normalizedRecord);
    this.db.transaction(() => {
      this.db.connection.prepare("INSERT INTO improvement_candidate_memory(fingerprint,payload_json,checksum,severity,score,occurrences,first_seen_at,last_seen_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(fingerprint) DO UPDATE SET payload_json=excluded.payload_json,checksum=excluded.checksum,severity=excluded.severity,score=excluded.score,occurrences=excluded.occurrences,first_seen_at=excluded.first_seen_at,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at").run(normalizedRecord.fingerprint, payload, hash(payload), normalizedRecord.severity, normalizedRecord.score, normalizedRecord.occurrences, normalizedRecord.firstSeenAt, normalizedRecord.lastSeenAt, normalizedRecord.lastSeenAt);
      this.db.connection.prepare("DELETE FROM improvement_candidate_memory WHERE fingerprint IN (SELECT fingerprint FROM improvement_candidate_memory ORDER BY score DESC, last_seen_at ASC, fingerprint ASC LIMIT -1 OFFSET ?)").run(this.maxRecords);
      if (this.get(normalizedRecord.fingerprint) == null) throw new Error("improvement candidate was evicted during save");
    });
  }

  public get(fingerprint: string): ImprovementCandidateMemoryRecord | undefined {
    const row = this.db.connection.prepare("SELECT payload_json, checksum FROM improvement_candidate_memory WHERE fingerprint=?").get(fingerprint) as Record<string, unknown> | undefined;
    return row == null ? undefined : decode(row);
  }

  public size(): number {
    const row = this.db.connection.prepare("SELECT COUNT(*) AS count FROM improvement_candidate_memory").get() as { count: number };
    return Number(row.count);
  }
}
