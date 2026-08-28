import { createHash } from "node:crypto";
import type { PersistedPaperPeriodEnvelope, PersistedPaperPeriodRecord } from "../../contracts/src/persistedPaperPeriod";
import type { SqliteDatabase } from "./index";

export type { PersistedPaperCandidateProvenance, PersistedPaperPeriodEnvelope, PersistedPaperPeriodRecord, PaperPeriodCostEvidence, PaperPeriodLifecycleStatus } from "../../contracts/src/persistedPaperPeriod";

export interface PersistedPaperPendingPeriod {
  readonly periodId: string;
  readonly periodIndex: number;
  readonly periodStartAt: number;
  readonly payloadJson: string;
  readonly checksum: string;
}

export class PersistedPaperPeriodStoreError extends Error {
  public constructor(readonly code: string, message: string, readonly recordId?: string) {
    super(message);
    this.name = "PersistedPaperPeriodStoreError";
  }
}

const TABLE = "research_paper_forward_periods";
const PENDING_TABLE = "research_paper_forward_period_pending";
const SHA256 = /^[a-f0-9]{64}$/;
const FORBIDDEN_KEY = /(authorization|bearer|token|secret|password|api[_-]?key|access[_-]?key|private[_-]?key|cookie|jwt|nonce|signature|account[_-]?id|order[_-]?id|fill[_-]?id)/i;
const checksum = (payload: string): string => createHash("sha256").update(payload, "utf8").digest("hex");
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function canonical(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new PersistedPaperPeriodStoreError("NON_FINITE_VALUE", "PAPER period contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item, seen)).join(",")}]`;
  if (typeof value === "object") {
    if (seen.has(value)) throw new PersistedPaperPeriodStoreError("CYCLIC_INPUT", "PAPER period must be acyclic");
    seen.add(value);
    const result = `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item, seen)}`).join(",")}}`;
    seen.delete(value);
    return result;
  }
  throw new PersistedPaperPeriodStoreError("UNSUPPORTED_VALUE", "PAPER period contains an unsupported value");
}

function rejectForbidden(value: unknown, seen = new Set<object>()): void {
  if (value == null || typeof value !== "object") return;
  if (seen.has(value)) throw new PersistedPaperPeriodStoreError("CYCLIC_INPUT", "PAPER period must be acyclic");
  seen.add(value);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(key)) throw new PersistedPaperPeriodStoreError("FORBIDDEN_FIELD", "PAPER period contains a forbidden field");
    rejectForbidden(child, seen);
  }
  seen.delete(value);
}

function validateEnvelope(envelope: PersistedPaperPeriodEnvelope): void {
  rejectForbidden(envelope);
  const { record } = envelope;
  if (record == null || typeof record !== "object" || typeof record.recordId !== "string" || !record.recordId.trim()) throw new PersistedPaperPeriodStoreError("INVALID_RECORD_ID", "PAPER period recordId is required");
  if (!Number.isSafeInteger(record.periodIndex) || record.periodIndex < 0) throw new PersistedPaperPeriodStoreError("INVALID_PERIOD_INDEX", "PAPER periodIndex must be a non-negative integer", record.recordId);
  if (![record.periodStartAt, record.periodEndAt].every((value) => Number.isSafeInteger(value) && value >= 0) || record.periodEndAt <= record.periodStartAt) throw new PersistedPaperPeriodStoreError("INVALID_PERIOD_BOUNDS", "PAPER period bounds are invalid", record.recordId);
  const advisoryAt = Date.parse(record.advisory.generatedAt);
  if (!Number.isFinite(advisoryAt)) throw new PersistedPaperPeriodStoreError("INVALID_ADVISORY_TIMESTAMP", "PAPER advisory.generatedAt must be a valid timestamp", record.recordId);
  if (advisoryAt >= record.periodStartAt) throw new PersistedPaperPeriodStoreError("LOOKAHEAD_ADVISORY_SNAPSHOT", "PAPER advisory must predate the realized period it is persisted against", record.recordId);
  if (!(record.status === "COMPLETED" || record.status === "REJECTED" || record.status === "HALTED")) throw new PersistedPaperPeriodStoreError("INVALID_STATUS", "PAPER period status is unsupported", record.recordId);
  if (record.costEvidence?.source !== "PAPER_EXECUTION_RECEIPT" || typeof record.costEvidence.evidenceId !== "string" || !record.costEvidence.evidenceId.trim() || !Number.isSafeInteger(record.costEvidence.observedAt) || record.costEvidence.observedAt < record.periodStartAt) throw new PersistedPaperPeriodStoreError("MISSING_COST_PROVENANCE", "PAPER period requires attributable execution cost evidence", record.recordId);
  for (const [field, value] of Object.entries({ benchmarkReturn: record.benchmarkReturn, turnoverCostRate: record.turnoverCostRate, ...record.realizedReturns, "costEvidence.feeRate": record.costEvidence.feeRate, "costEvidence.spreadRate": record.costEvidence.spreadRate, "costEvidence.slippageRate": record.costEvidence.slippageRate })) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new PersistedPaperPeriodStoreError("NON_FINITE_VALUE", `${field} must be finite`, record.recordId);
  }
  if (record.turnoverCostRate < 0 || record.costEvidence.feeRate < 0 || record.costEvidence.spreadRate < 0 || record.costEvidence.slippageRate < 0) throw new PersistedPaperPeriodStoreError("INVALID_COST_EVIDENCE", "PAPER period costs must be non-negative", record.recordId);
  const advisoryIds = new Set(record.advisory.entries.map((entry) => entry.id));
  const provenanceIds = new Set<string>();
  for (const provenance of envelope.candidateProvenance) {
    if (!provenance.candidateId.trim() || provenanceIds.has(provenance.candidateId)) throw new PersistedPaperPeriodStoreError("INVALID_CANDIDATE_PROVENANCE", "candidate provenance identity is missing or duplicated", record.recordId);
    if (!provenance.datasetId.trim() || !SHA256.test(provenance.datasetContentSha256)) throw new PersistedPaperPeriodStoreError("INVALID_DATASET_PROVENANCE", "candidate dataset provenance is incomplete", record.recordId);
    provenanceIds.add(provenance.candidateId);
  }
  for (const id of advisoryIds) if (!provenanceIds.has(id)) throw new PersistedPaperPeriodStoreError("MISSING_CANDIDATE_PROVENANCE", `candidate ${id} has no persisted dataset provenance`, record.recordId);
  for (const id of provenanceIds) if (!advisoryIds.has(id)) throw new PersistedPaperPeriodStoreError("UNKNOWN_CANDIDATE_PROVENANCE", `candidate ${id} is not present in the persisted advisory`, record.recordId);
}

function decodeEnvelope(row: { record_id?: unknown; payload_json?: unknown; checksum?: unknown }): PersistedPaperPeriodEnvelope {
  const recordId = String(row.record_id ?? "");
  try {
    const payload = String(row.payload_json ?? "");
    const parsed = JSON.parse(payload) as PersistedPaperPeriodEnvelope;
    if (checksum(payload) !== String(row.checksum ?? "")) throw new PersistedPaperPeriodStoreError("CHECKSUM_MISMATCH", "persisted PAPER period checksum mismatch", recordId);
    validateEnvelope(parsed);
    if (parsed.record.recordId !== recordId) throw new PersistedPaperPeriodStoreError("RECORD_ID_MISMATCH", "persisted PAPER period row identity mismatch", recordId);
    return freeze({ record: freeze({ ...parsed.record, costEvidence: freeze({ ...parsed.record.costEvidence }), realizedReturns: freeze({ ...parsed.record.realizedReturns }) }), candidateProvenance: freeze(parsed.candidateProvenance.map((item) => freeze({ ...item }))) });
  } catch (error) {
    if (error instanceof PersistedPaperPeriodStoreError) throw error;
    throw new PersistedPaperPeriodStoreError("MALFORMED_PERSISTED_PERIOD", "persisted PAPER period payload is malformed", recordId);
  }
}

export class SqlitePersistedPaperPeriodStore {
  public constructor(private readonly db: SqliteDatabase) {
    this.db.connection.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        record_id TEXT PRIMARY KEY,
        period_index INTEGER NOT NULL UNIQUE,
        period_start_at INTEGER NOT NULL,
        period_end_at INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        checksum TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_research_paper_forward_periods_chronology ON ${TABLE} (period_index ASC, period_start_at ASC, record_id ASC);
      CREATE TABLE IF NOT EXISTS ${PENDING_TABLE} (
        period_id TEXT PRIMARY KEY,
        period_index INTEGER NOT NULL UNIQUE,
        period_start_at INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        checksum TEXT NOT NULL
      );
    `);
  }

  public append(envelope: PersistedPaperPeriodEnvelope): PersistedPaperPeriodEnvelope {
    validateEnvelope(envelope);
    const payload = canonical(envelope);
    const digest = checksum(payload);
    this.db.transaction(() => {
      const existing = this.db.connection.prepare(`SELECT payload_json, checksum FROM ${TABLE} WHERE record_id = ?`).get(envelope.record.recordId) as { payload_json?: string; checksum?: string } | undefined;
      if (existing != null) {
        if (existing.checksum !== digest || existing.payload_json !== payload) throw new PersistedPaperPeriodStoreError("RECORD_ID_CONFLICT", "persisted PAPER recordId was reused with different evidence", envelope.record.recordId);
        return;
      }
      const chronologyConflict = this.db.connection.prepare(`SELECT record_id FROM ${TABLE} WHERE (period_index < ? AND period_end_at > ?) OR (period_index > ? AND period_start_at < ?) LIMIT 1`).get(envelope.record.periodIndex, envelope.record.periodStartAt, envelope.record.periodIndex, envelope.record.periodEndAt) as { record_id?: string } | undefined;
      if (chronologyConflict != null) throw new PersistedPaperPeriodStoreError("PERIOD_CHRONOLOGY_CONFLICT", `PAPER period chronology conflicts with ${String(chronologyConflict.record_id)}`, envelope.record.recordId);
      try { this.db.connection.prepare(`INSERT INTO ${TABLE} (record_id, period_index, period_start_at, period_end_at, payload_json, checksum) VALUES (?, ?, ?, ?, ?, ?)`).run(envelope.record.recordId, envelope.record.periodIndex, envelope.record.periodStartAt, envelope.record.periodEndAt, payload, digest); }
      catch (error) { throw new PersistedPaperPeriodStoreError("PERIOD_INDEX_CONFLICT", error instanceof Error ? error.message : "PAPER period persistence failed", envelope.record.recordId); }
    });
    return envelope;
  }

  public putPending(input: PersistedPaperPendingPeriod): void {
    if (!input.periodId.trim() || !Number.isSafeInteger(input.periodIndex) || input.periodIndex < 0 || !Number.isSafeInteger(input.periodStartAt) || input.periodStartAt < 0) throw new PersistedPaperPeriodStoreError("INVALID_PENDING_PERIOD", "pending PAPER period identity is invalid", input.periodId);
    this.db.transaction(() => {
      const existing = this.db.connection.prepare(`SELECT period_index, period_start_at, payload_json, checksum FROM ${PENDING_TABLE} WHERE period_id = ?`).get(input.periodId) as Record<string, unknown> | undefined;
      if (existing != null) {
        if (Number(existing.period_index) !== input.periodIndex || Number(existing.period_start_at) !== input.periodStartAt || String(existing.payload_json) !== input.payloadJson || String(existing.checksum) !== input.checksum) throw new PersistedPaperPeriodStoreError("PERIOD_ID_CONFLICT", "pending PAPER period was reused with different evidence", input.periodId);
        return;
      }
      try { this.db.connection.prepare(`INSERT INTO ${PENDING_TABLE} (period_id, period_index, period_start_at, payload_json, checksum) VALUES (?, ?, ?, ?, ?)`).run(input.periodId, input.periodIndex, input.periodStartAt, input.payloadJson, input.checksum); }
      catch (error) { throw new PersistedPaperPeriodStoreError("PERIOD_INDEX_CONFLICT", error instanceof Error ? error.message : "pending PAPER period persistence failed", input.periodId); }
    });
  }

  public updatePending(input: PersistedPaperPendingPeriod): void {
    this.db.transaction(() => {
      const result = this.db.connection.prepare(`UPDATE ${PENDING_TABLE} SET payload_json = ?, checksum = ? WHERE period_id = ?`).run(input.payloadJson, input.checksum, input.periodId) as { changes?: number };
      if (Number(result.changes ?? 0) !== 1) throw new PersistedPaperPeriodStoreError("PENDING_NOT_FOUND", "pending PAPER period disappeared during update", input.periodId);
    });
  }

  public prune(maximumPeriods: number): void {
    if (!Number.isSafeInteger(maximumPeriods) || maximumPeriods < 1 || maximumPeriods > 1_000) throw new PersistedPaperPeriodStoreError("INVALID_RETENTION", "PAPER period retention must be between 1 and 1000");
    this.db.transaction(() => this.db.connection.prepare(`DELETE FROM ${TABLE} WHERE record_id NOT IN (SELECT record_id FROM ${TABLE} ORDER BY period_index DESC, record_id DESC LIMIT ?)`).run(maximumPeriods));
  }

  public getPending(periodId: string): PersistedPaperPendingPeriod | undefined {
    const row = this.db.connection.prepare(`SELECT period_id, period_index, period_start_at, payload_json, checksum FROM ${PENDING_TABLE} WHERE period_id = ?`).get(periodId) as Record<string, unknown> | undefined;
    return row == null ? undefined : { periodId: String(row.period_id), periodIndex: Number(row.period_index), periodStartAt: Number(row.period_start_at), payloadJson: String(row.payload_json), checksum: String(row.checksum) };
  }

  public listPending(): readonly PersistedPaperPendingPeriod[] {
    const rows = this.db.connection.prepare(`SELECT period_id, period_index, period_start_at, payload_json, checksum FROM ${PENDING_TABLE} ORDER BY period_index ASC, period_id ASC`).all() as Array<Record<string, unknown>>;
    return freeze(rows.map((row) => ({ periodId: String(row.period_id), periodIndex: Number(row.period_index), periodStartAt: Number(row.period_start_at), payloadJson: String(row.payload_json), checksum: String(row.checksum) })));
  }

  public finalizePending(periodId: string, expectedChecksum: string, envelope: PersistedPaperPeriodEnvelope): PersistedPaperPeriodEnvelope {
    return this.db.transaction(() => {
      const pending = this.getPending(periodId);
      if (pending == null || pending.checksum !== expectedChecksum) throw new PersistedPaperPeriodStoreError("PENDING_IDENTITY_CONFLICT", "pending PAPER period evidence is unavailable or changed", periodId);
      const stored = this.append(envelope);
      this.db.connection.prepare(`DELETE FROM ${PENDING_TABLE} WHERE period_id = ? AND checksum = ?`).run(periodId, expectedChecksum);
      return stored;
    });
  }

  public list(): readonly PersistedPaperPeriodEnvelope[] {
    const rows = this.db.connection.prepare(`SELECT record_id, payload_json, checksum FROM ${TABLE} ORDER BY period_index ASC, period_start_at ASC, record_id ASC`).all() as Array<Record<string, unknown>>;
    return freeze(rows.map((row) => decodeEnvelope(row)));
  }

  public listRecords(): readonly PersistedPaperPeriodRecord[] { return freeze(this.list().map((envelope) => envelope.record)); }
}
