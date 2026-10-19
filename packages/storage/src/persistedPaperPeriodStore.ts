import { createHash } from "node:crypto";
import type { PersistedPaperPeriodEnvelope, PersistedPaperPeriodRecord } from "../../contracts/src/persistedPaperPeriod";
import type { SqliteDatabase } from "./index";

export type { PersistedPaperCandidateProvenance, PersistedPaperPeriodEnvelope, PersistedPaperPeriodRecord, PaperPeriodCostEvidence, PaperPeriodCostEvidenceKind, PaperPeriodLifecycleStatus } from "../../contracts/src/persistedPaperPeriod";

export interface PersistedPaperPendingPeriod {
  readonly periodId: string;
  readonly periodIndex: number;
  readonly periodStartAt: number;
  readonly payloadJson: string;
  readonly checksum: string;
}

/** A storage receipt is not realized performance, strategy failure, or qualification. */
export interface PaperPendingIneligibilityReason {
  readonly stage: "PERIOD_CLOSE";
  readonly code: "INCOMPLETE_EXECUTION_COST_EVIDENCE";
  readonly boundaryAt: number;
  /** Revision of the observing runtime, never inferred from historical candidate code. */
  readonly sourceRuntimeSha: string | null;
  readonly blockedEvidenceFingerprintSha256: string;
}

export interface PersistedPaperPendingDisposition {
  readonly schemaVersion: 2;
  readonly kind: "INELIGIBLE_PENDING_PERIOD";
  readonly evidenceFingerprintSha256: string;
  readonly original: PersistedPaperPendingPeriod;
  readonly reason: PaperPendingIneligibilityReason;
  readonly successor: PersistedPaperPendingPeriod;
  readonly validPerformanceEvidence: false;
  readonly paperOnly: true;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

export class PersistedPaperPeriodStoreError extends Error {
  public constructor(readonly code: string, message: string, readonly recordId?: string) {
    super(message);
    this.name = "PersistedPaperPeriodStoreError";
  }
}

/**
 * Resolves the realized PAPER periods that must survive retention because a surviving record cites
 * them. Lineage replay selects evidence by exact `paper-period:<recordId>`
 * (closedLearningLineageReplayInputSource.ts:89-127) and the evidence identity embeds those record
 * ids, so a period pruned underneath a recorded cycle leaves its receipt resolvable and its basis
 * gone. Retention is the one place realized Lane B evidence is physically deleted, so the guard is a
 * required parameter rather than an optional courtesy: `prune()` cannot be called blindly (v2 Impact
 * Analysis M1 / A7).
 */
export type RealizedPeriodRetentionGuard = {
  /** Record ids that must not be pruned. Evaluated at each retention, never cached across them. */
  readonly referencedRecordIds: () => ReadonlySet<string>;
};

export interface PersistedPaperPeriodRetentionResult {
  /** The owner-set retention bound. Never learned, never adapted, never derived from evidence. */
  readonly bound: number;
  readonly deleted: number;
  /** Periods retained beyond the bound because a surviving record cites them. */
  readonly protectedRecordIds: readonly string[];
  /** True only when the bound was reached with nothing protected. */
  readonly boundReached: boolean;
  /**
   * Citations of periods that are already absent. Reported unverifiable and never re-derived: the
   * receipt survives, its basis does not, and inventing a replacement would rewrite history.
   */
  readonly danglingReferences: readonly string[];
}

const TABLE = "research_paper_forward_periods";
const PENDING_TABLE = "research_paper_forward_period_pending";
const SHA256 = /^[a-f0-9]{64}$/;
const MARKET = /^KRW-[A-Z0-9-]+$/;
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
  if (record.market !== undefined && (typeof record.market !== "string" || !MARKET.test(record.market.trim().toUpperCase()))) throw new PersistedPaperPeriodStoreError("INVALID_MARKET", "PAPER period market is invalid", record.recordId);
  const advisoryAt = Date.parse(record.advisory.generatedAt);
  if (!Number.isFinite(advisoryAt)) throw new PersistedPaperPeriodStoreError("INVALID_ADVISORY_TIMESTAMP", "PAPER advisory.generatedAt must be a valid timestamp", record.recordId);
  if (advisoryAt >= record.periodStartAt) throw new PersistedPaperPeriodStoreError("LOOKAHEAD_ADVISORY_SNAPSHOT", "PAPER advisory must predate the realized period it is persisted against", record.recordId);
  if (!(record.status === "COMPLETED" || record.status === "REJECTED" || record.status === "HALTED")) throw new PersistedPaperPeriodStoreError("INVALID_STATUS", "PAPER period status is unsupported", record.recordId);
  if (record.benchmarkEvidenceId !== undefined && (typeof record.benchmarkEvidenceId !== "string" || !record.benchmarkEvidenceId.trim() || FORBIDDEN_KEY.test(record.benchmarkEvidenceId))) throw new PersistedPaperPeriodStoreError("INVALID_BENCHMARK_PROVENANCE", "benchmark evidence identity is invalid", record.recordId);
  if (record.benchmarkInputFingerprintSha256 !== undefined && !SHA256.test(record.benchmarkInputFingerprintSha256)) throw new PersistedPaperPeriodStoreError("INVALID_BENCHMARK_PROVENANCE", "benchmark input fingerprint is invalid", record.recordId);
  if (record.benchmarkInputFingerprintSha256 !== undefined && record.benchmarkEvidenceId === undefined) throw new PersistedPaperPeriodStoreError("INVALID_BENCHMARK_PROVENANCE", "benchmark input fingerprint requires an evidence identity", record.recordId);
  if (record.canonicalOutcomeReceiptFingerprint !== undefined && !SHA256.test(record.canonicalOutcomeReceiptFingerprint)) throw new PersistedPaperPeriodStoreError("INVALID_OUTCOME_PROVENANCE", "canonical PAPER outcome fingerprint is invalid", record.recordId);
  if (record.costEvidence?.source !== "PAPER_EXECUTION_RECEIPT" || typeof record.costEvidence.evidenceId !== "string" || !record.costEvidence.evidenceId.trim() || (record.costEvidence.evidenceKind !== "OBSERVED" && record.costEvidence.evidenceKind !== "CONSERVATIVE_MODEL") || !SHA256.test(record.costEvidence.evidenceFingerprintSha256) || !Number.isSafeInteger(record.costEvidence.observedAt) || record.costEvidence.observedAt < record.periodStartAt) throw new PersistedPaperPeriodStoreError("MISSING_COST_PROVENANCE", "PAPER period requires attributable execution cost evidence", record.recordId);
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

function dispositionError(): never {
  throw new PersistedPaperPeriodStoreError("INVALID_PENDING_DISPOSITION", "pending PAPER disposition is malformed or conflicts with its immutable evidence");
}

function exactKeys(value: object, keys: readonly string[]): void {
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) dispositionError();
}

function validatePendingSnapshot(value: PersistedPaperPendingPeriod): void {
  if (value == null || typeof value !== "object") dispositionError();
  exactKeys(value, ["periodId", "periodIndex", "periodStartAt", "payloadJson", "checksum"]);
  if (typeof value.periodId !== "string" || !value.periodId.trim() || !Number.isSafeInteger(value.periodIndex) || value.periodIndex < 0
    || !Number.isSafeInteger(value.periodStartAt) || value.periodStartAt < 0 || typeof value.payloadJson !== "string"
    || value.payloadJson.length > 2_000_000 || !SHA256.test(value.checksum) || checksum(value.payloadJson) !== value.checksum) dispositionError();
  const plan = JSON.parse(value.payloadJson) as Record<string, unknown>;
  if (plan == null || plan.schemaVersion !== 1 || plan.periodId !== value.periodId || plan.periodIndex !== value.periodIndex || plan.periodStartAt !== value.periodStartAt) dispositionError();
}

function validateDisposition(value: PersistedPaperPendingDisposition, row: PersistedPaperPendingPeriod): void {
  exactKeys(value, ["schemaVersion", "kind", "evidenceFingerprintSha256", "original", "reason", "successor", "validPerformanceEvidence", "paperOnly", "liveAuthority", "productionMutationAllowed", "aiAuthority"]);
  if (value.schemaVersion !== 2 || value.kind !== "INELIGIBLE_PENDING_PERIOD" || value.validPerformanceEvidence !== false
    || value.paperOnly !== true || value.liveAuthority !== "NONE" || value.productionMutationAllowed !== false || value.aiAuthority !== "ZERO_AUTHORITY") dispositionError();
  const { evidenceFingerprintSha256, ...body } = value;
  if (typeof evidenceFingerprintSha256 !== "string" || !SHA256.test(evidenceFingerprintSha256) || checksum(canonical(body)) !== evidenceFingerprintSha256) dispositionError();
  validatePendingSnapshot(value.original);
  validatePendingSnapshot(value.successor);
  if (value.original.periodId !== row.periodId || value.original.periodIndex !== row.periodIndex || value.original.periodStartAt !== row.periodStartAt) dispositionError();
  const reason = value.reason;
  if (reason == null || typeof reason !== "object") dispositionError();
  exactKeys(reason, ["stage", "code", "boundaryAt", "sourceRuntimeSha", "blockedEvidenceFingerprintSha256"]);
  if (reason.stage !== "PERIOD_CLOSE" || reason.code !== "INCOMPLETE_EXECUTION_COST_EVIDENCE" || !Number.isSafeInteger(reason.boundaryAt)
    || reason.boundaryAt <= value.original.periodStartAt || !(reason.sourceRuntimeSha === null || (typeof reason.sourceRuntimeSha === "string" && /^[a-f0-9]{40}$/.test(reason.sourceRuntimeSha)))
    || typeof reason.blockedEvidenceFingerprintSha256 !== "string" || !SHA256.test(reason.blockedEvidenceFingerprintSha256)) dispositionError();
  if (value.successor.periodIndex !== value.original.periodIndex + 1 || value.successor.periodStartAt !== reason.boundaryAt || value.successor.periodId === value.original.periodId) dispositionError();
}

/** Old binaries reject schemaVersion=2 instead of silently reactivating the quarantined plan. */
function decodeDisposition(row: PersistedPaperPendingPeriod): PersistedPaperPendingDisposition | undefined {
  try {
    const value = JSON.parse(row.payloadJson) as PersistedPaperPendingDisposition | { readonly schemaVersion?: unknown };
    if (value == null || typeof value !== "object") dispositionError();
    if (value.schemaVersion === 1 && !("kind" in value)) return undefined;
    if (checksum(row.payloadJson) !== row.checksum) dispositionError();
    validateDisposition(value as PersistedPaperPendingDisposition, row);
    return value as PersistedPaperPendingDisposition;
  } catch (error) {
    if (error instanceof PersistedPaperPeriodStoreError) throw error;
    return dispositionError();
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
      if (this.rawPendingRows().some((row) => {
        const terminal = decodeDisposition(row);
        if (terminal == null) return false;
        const successor = terminal.successor;
        const touchesOriginal = row.periodId === envelope.record.recordId || row.periodIndex === envelope.record.periodIndex;
        if (touchesOriginal) return true;
        const touchesSuccessor = successor.periodId === envelope.record.recordId || successor.periodIndex === envelope.record.periodIndex;
        if (touchesSuccessor) {
          const active = this.rawPending(successor.periodId);
          const activeMatchesReceipt = active != null && decodeDisposition(active) == null && canonical(active) === canonical(successor);
          const recordMatchesSuccessor = envelope.record.recordId === successor.periodId && envelope.record.periodIndex === successor.periodIndex && envelope.record.periodStartAt === successor.periodStartAt;
          if (!(activeMatchesReceipt && recordMatchesSuccessor)) return true;
        }
        return envelope.record.periodStartAt < terminal.reason.boundaryAt && envelope.record.periodEndAt > row.periodStartAt;
      })) {
        throw new PersistedPaperPeriodStoreError("PENDING_TERMINAL", "ineligible PAPER period cannot become realized performance", envelope.record.recordId);
      }
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
      if (this.listPendingDispositions().some((item) => [item.original, item.successor].some((reserved) => reserved.periodIndex === input.periodIndex || reserved.periodId === input.periodId))) {
        throw new PersistedPaperPeriodStoreError("PERIOD_INDEX_CONFLICT", "pending identity or index is reserved by immutable disposition history", input.periodId);
      }
      try { this.db.connection.prepare(`INSERT INTO ${PENDING_TABLE} (period_id, period_index, period_start_at, payload_json, checksum) VALUES (?, ?, ?, ?, ?)`).run(input.periodId, input.periodIndex, input.periodStartAt, input.payloadJson, input.checksum); }
      catch (error) { throw new PersistedPaperPeriodStoreError("PERIOD_INDEX_CONFLICT", error instanceof Error ? error.message : "pending PAPER period persistence failed", input.periodId); }
    });
  }

  public updatePending(input: PersistedPaperPendingPeriod): void {
    this.db.transaction(() => {
      const current = this.rawPending(input.periodId);
      if (current != null && decodeDisposition(current) != null) throw new PersistedPaperPeriodStoreError("PENDING_TERMINAL", "ineligible PAPER period is immutable", input.periodId);
      const result = this.db.connection.prepare(`UPDATE ${PENDING_TABLE} SET payload_json = ?, checksum = ? WHERE period_id = ?`).run(input.payloadJson, input.checksum, input.periodId) as { changes?: number };
      if (Number(result.changes ?? 0) !== 1) throw new PersistedPaperPeriodStoreError("PENDING_NOT_FOUND", "pending PAPER period disappeared during update", input.periodId);
    });
  }

  public prune(maximumPeriods: number, guard: RealizedPeriodRetentionGuard): PersistedPaperPeriodRetentionResult {
    if (!Number.isSafeInteger(maximumPeriods) || maximumPeriods < 1 || maximumPeriods > 1_000) throw new PersistedPaperPeriodStoreError("INVALID_RETENTION", "PAPER period retention must be between 1 and 1000");
    if (guard == null || typeof guard.referencedRecordIds !== "function") throw new PersistedPaperPeriodStoreError("MISSING_RETENTION_GUARD", "PAPER period retention requires a reference-aware guard");
    return this.db.transaction(() => {
      const retained = new Set((this.db.connection.prepare(`SELECT record_id FROM ${TABLE} ORDER BY period_index DESC, record_id DESC LIMIT ?`).all(maximumPeriods) as Array<Record<string, unknown>>).map((row) => String(row.record_id)));
      const present = (this.db.connection.prepare(`SELECT record_id FROM ${TABLE}`).all() as Array<Record<string, unknown>>).map((row) => String(row.record_id));
      const presentSet = new Set(present);
      const referenced = guard.referencedRecordIds();
      const victims = present.filter((recordId) => !retained.has(recordId));
      const protectedRecordIds = victims.filter((recordId) => referenced.has(recordId));
      const danglingReferences = [...referenced].filter((recordId) => !presentSet.has(recordId)).sort();
      const deletable = victims.filter((recordId) => !referenced.has(recordId));
      for (const recordId of deletable) this.db.connection.prepare(`DELETE FROM ${TABLE} WHERE record_id = ?`).run(recordId);
      return Object.freeze({
        bound: maximumPeriods,
        deleted: deletable.length,
        protectedRecordIds: Object.freeze(protectedRecordIds),
        boundReached: protectedRecordIds.length === 0 && retained.size === maximumPeriods,
        danglingReferences: Object.freeze(danglingReferences),
      });
    });
  }

  private rawPending(periodId: string): PersistedPaperPendingPeriod | undefined {
    const row = this.db.connection.prepare(`SELECT period_id, period_index, period_start_at, payload_json, checksum FROM ${PENDING_TABLE} WHERE period_id = ?`).get(periodId) as Record<string, unknown> | undefined;
    return row == null ? undefined : { periodId: String(row.period_id), periodIndex: Number(row.period_index), periodStartAt: Number(row.period_start_at), payloadJson: String(row.payload_json), checksum: String(row.checksum) };
  }

  public getPending(periodId: string): PersistedPaperPendingPeriod | undefined {
    const row = this.rawPending(periodId);
    return row == null || decodeDisposition(row) != null ? undefined : row;
  }

  private rawPendingRows(): readonly PersistedPaperPendingPeriod[] {
    const rows = this.db.connection.prepare(`SELECT period_id, period_index, period_start_at, payload_json, checksum FROM ${PENDING_TABLE} ORDER BY period_index ASC, period_id ASC`).all() as Array<Record<string, unknown>>;
    return freeze(rows.map((row) => ({ periodId: String(row.period_id), periodIndex: Number(row.period_index), periodStartAt: Number(row.period_start_at), payloadJson: String(row.payload_json), checksum: String(row.checksum) })));
  }

  public listPending(): readonly PersistedPaperPendingPeriod[] {
    return freeze(this.rawPendingRows().filter((row) => decodeDisposition(row) == null));
  }

  public listPendingDispositions(): readonly PersistedPaperPendingDisposition[] {
    return freeze(this.rawPendingRows().flatMap((row) => {
      const disposition = decodeDisposition(row);
      return disposition == null ? [] : [disposition];
    }));
  }

  public nextPeriodIndex(): number {
    const pending = this.rawPendingRows();
    let maximum = -1;
    for (const row of pending) {
      const disposition = decodeDisposition(row);
      if (disposition == null) validatePendingSnapshot(row);
      maximum = Math.max(maximum, row.periodIndex);
      if (disposition != null) maximum = Math.max(maximum, disposition.successor.periodIndex);
    }
    for (const envelope of this.list()) maximum = Math.max(maximum, envelope.record.periodIndex);
    if (!Number.isSafeInteger(maximum) || maximum < -1 || maximum >= Number.MAX_SAFE_INTEGER - 1) {
      throw new PersistedPaperPeriodStoreError("PERIOD_INDEX_UNAVAILABLE", "PAPER period index is unavailable");
    }
    return maximum + 1;
  }

  public markPendingIneligible(input: {
    readonly original: PersistedPaperPendingPeriod;
    readonly reason: PaperPendingIneligibilityReason;
    readonly successor: PersistedPaperPendingPeriod;
  }): PersistedPaperPendingDisposition {
    const body = {
      schemaVersion: 2, kind: "INELIGIBLE_PENDING_PERIOD", ...input,
      validPerformanceEvidence: false, paperOnly: true, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY",
    } as const;
    const disposition: PersistedPaperPendingDisposition = { ...body, evidenceFingerprintSha256: checksum(canonical(body)) };
    try { validateDisposition(disposition, input.original); }
    catch { return dispositionError(); }
    const payload = canonical(disposition);
    return this.db.transaction(() => {
      const current = this.rawPending(input.original.periodId);
      if (current == null) throw new PersistedPaperPeriodStoreError("PENDING_IDENTITY_CONFLICT", "pending PAPER period is unavailable", input.original.periodId);
      const terminal = decodeDisposition(current);
      if (terminal != null) {
        if (current.payloadJson !== payload || current.checksum !== checksum(payload)) dispositionError();
        return terminal;
      }
      if (canonical(current) !== canonical(input.original)) throw new PersistedPaperPeriodStoreError("PENDING_IDENTITY_CONFLICT", "pending PAPER evidence changed before disposition", current.periodId);
      const others = this.rawPendingRows().filter((row) => row.periodId !== current.periodId);
      if (others.some((row) => decodeDisposition(row) == null || row.periodIndex >= current.periodIndex)
        || this.list().some((item) => item.record.periodIndex >= current.periodIndex || item.record.periodEndAt > current.periodStartAt)) {
        throw new PersistedPaperPeriodStoreError("PERIOD_CHRONOLOGY_CONFLICT", "PAPER disposition would overlap existing history", current.periodId);
      }
      const result = this.db.connection.prepare(`UPDATE ${PENDING_TABLE} SET payload_json = ?, checksum = ? WHERE period_id = ? AND checksum = ?`)
        .run(payload, checksum(payload), current.periodId, current.checksum) as { changes?: number };
      if (Number(result.changes ?? 0) !== 1) throw new PersistedPaperPeriodStoreError("PENDING_IDENTITY_CONFLICT", "pending PAPER evidence changed during disposition", current.periodId);
      try {
        this.db.connection.prepare(`INSERT INTO ${PENDING_TABLE} (period_id, period_index, period_start_at, payload_json, checksum) VALUES (?, ?, ?, ?, ?)`)
          .run(input.successor.periodId, input.successor.periodIndex, input.successor.periodStartAt, input.successor.payloadJson, input.successor.checksum);
      } catch (error) {
        throw new PersistedPaperPeriodStoreError("PERIOD_INDEX_CONFLICT", error instanceof Error ? error.message : "pending PAPER successor persistence failed", input.successor.periodId);
      }
      return JSON.parse(payload) as PersistedPaperPendingDisposition;
    });
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

  public retirePending(periodId: string, expectedChecksum: string): void {
    this.db.transaction(() => {
      const current = this.rawPending(periodId);
      if (current != null && decodeDisposition(current) != null) throw new PersistedPaperPeriodStoreError("PENDING_TERMINAL", "ineligible PAPER period is immutable", periodId);
      const result = this.db.connection.prepare(`DELETE FROM ${PENDING_TABLE} WHERE period_id = ? AND checksum = ?`).run(periodId, expectedChecksum) as { changes?: number };
      if (Number(result.changes ?? 0) !== 1) throw new PersistedPaperPeriodStoreError("PENDING_IDENTITY_CONFLICT", "pending PAPER period evidence is unavailable or changed", periodId);
    });
  }

  public list(): readonly PersistedPaperPeriodEnvelope[] {
    const rows = this.db.connection.prepare(`SELECT record_id, payload_json, checksum FROM ${TABLE} ORDER BY period_index ASC, period_start_at ASC, record_id ASC`).all() as Array<Record<string, unknown>>;
    return freeze(rows.map((row) => decodeEnvelope(row)));
  }

  public listRecords(): readonly PersistedPaperPeriodRecord[] { return freeze(this.list().map((envelope) => envelope.record)); }
}
