import { createHash } from "node:crypto";
import type { PaperForwardPeriodEvidence, PaperForwardPeriodStatus } from "../../../packages/contracts/src/paperForwardEvidence";
import type { SqliteDatabase } from "../../../packages/storage/src/index";

export interface PaperRealizedPeriodOpenInput {
  readonly periodId: string;
  readonly periodIndex: number;
  readonly candidateId: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly advisoryGeneratedAt: number;
  readonly periodStartAt: number;
}

export interface PersistedPaperRealizedPeriodPlan extends PaperRealizedPeriodOpenInput {
  readonly schemaVersion: 1;
  readonly observationIds: readonly string[];
  readonly observations: readonly PaperRuntimeObservation[];
  readonly lastObservedAt?: number;
}

export interface PaperRealizedPeriodCloseInput {
  readonly periodId: string;
  readonly periodEndAt: number;
  readonly grossReturn: number;
  readonly turnover: number;
  readonly feeRate: number;
  readonly spreadRate: number;
  readonly slippageRate: number;
  readonly status: PaperForwardPeriodStatus;
}

export interface PaperRuntimeObservation {
  readonly observationId: string;
  readonly observedAt: number;
  readonly status: "FILLED" | "WAIT" | "BLOCKED" | "REJECTED" | "FAILED" | "DUPLICATE";
}

export interface PaperRealizedPeriodRepository {
  open(plan: PersistedPaperRealizedPeriodPlan): PersistedPaperRealizedPeriodPlan;
  observe(periodId: string, observation: PaperRuntimeObservation): PersistedPaperRealizedPeriodPlan;
  realize(evidence: PaperForwardPeriodEvidence): PaperForwardPeriodEvidence;
  getRealized(periodId: string): PaperForwardPeriodEvidence | undefined;
  list(): readonly PaperForwardPeriodEvidence[];
  listOpen(): readonly PersistedPaperRealizedPeriodPlan[];
}

export class PaperRealizedPeriodProducerError extends Error {
  public constructor(readonly code: string, message: string, readonly periodId?: string) {
    super(message);
    this.name = "PaperRealizedPeriodProducerError";
  }
}

const TABLE = "paper_realized_periods";
const SHA256 = /^[a-f0-9]{64}$/;
const FORBIDDEN_KEY = /(authorization|bearer|token|secret|password|api[_-]?key|access[_-]?key|private[_-]?key|cookie|jwt|nonce|signature|account[_-]?id|order[_-]?id|fill[_-]?id)/i;
const OBSERVATION_STATUSES = new Set<PaperRuntimeObservation["status"]>(["FILLED", "WAIT", "BLOCKED", "REJECTED", "FAILED", "DUPLICATE"]);
const PERIOD_STATUSES = new Set<PaperForwardPeriodStatus>(["COMPLETED", "REJECTED", "HALTED"]);
const DEFAULT_MAXIMUM_PERIODS = 100;
const MAXIMUM_OBSERVATIONS = 1_024;

const freeze = <T>(value: T): T => Object.freeze(value);

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new PaperRealizedPeriodProducerError("NON_FINITE_VALUE", "period evidence contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  throw new PaperRealizedPeriodProducerError("UNSUPPORTED_VALUE", "period evidence contains an unsupported value");
}

function digest(value: unknown): string { return createHash("sha256").update(canonical(value), "utf8").digest("hex"); }

function safeText(value: unknown, field: string): string {
  if (typeof value !== "string") throw new PaperRealizedPeriodProducerError("INVALID_IDENTIFIER", `${field} must be text`);
  const normalized = value.trim();
  if (!normalized || normalized.length > 256 || FORBIDDEN_KEY.test(normalized)) throw new PaperRealizedPeriodProducerError("INVALID_IDENTIFIER", `${field} is invalid`);
  return normalized;
}

function safeTime(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new PaperRealizedPeriodProducerError("INVALID_TIMESTAMP", `${field} must be a non-negative safe integer`);
  return Number(value);
}

function finite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new PaperRealizedPeriodProducerError("NON_FINITE_VALUE", `${field} must be finite`);
  return value;
}

function rejectForbiddenFields(value: unknown, seen = new Set<object>()): void {
  if (value == null || typeof value !== "object") return;
  if (seen.has(value)) throw new PaperRealizedPeriodProducerError("CYCLIC_INPUT", "period evidence must be acyclic");
  seen.add(value);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(key)) throw new PaperRealizedPeriodProducerError("FORBIDDEN_FIELD", "period evidence contains a forbidden field");
    rejectForbiddenFields(child, seen);
  }
  seen.delete(value);
}

function validatePlan(input: PersistedPaperRealizedPeriodPlan): PersistedPaperRealizedPeriodPlan {
  rejectForbiddenFields(input);
  if (input.schemaVersion !== 1) throw new PaperRealizedPeriodProducerError("UNSUPPORTED_SCHEMA", "PAPER period schema is unsupported", input.periodId);
  const observationIds = [...input.observationIds].map((id) => safeText(id, "observationId"));
  const observations = [...input.observations].map(validateObservation);
  if (observations.length !== observationIds.length || observations.some((observation, index) => observation.observationId !== observationIds[index])) {
    throw new PaperRealizedPeriodProducerError("INVALID_OBSERVATIONS", "period observation identities are inconsistent", input.periodId);
  }
  const latestObservedAt = observations.reduce<number | undefined>((latest, observation) => latest === undefined ? observation.observedAt : Math.max(latest, observation.observedAt), undefined);
  if (input.lastObservedAt !== undefined && latestObservedAt !== undefined && input.lastObservedAt !== latestObservedAt) {
    throw new PaperRealizedPeriodProducerError("INVALID_OBSERVATION_TIME", "period observation timestamp is inconsistent", input.periodId);
  }
  const plan = {
    schemaVersion: 1 as const,
    periodId: safeText(input.periodId, "periodId"),
    periodIndex: input.periodIndex,
    candidateId: safeText(input.candidateId, "candidateId"),
    datasetId: safeText(input.datasetId, "datasetId"),
    datasetContentSha256: safeText(input.datasetContentSha256, "datasetContentSha256"),
    advisoryGeneratedAt: safeTime(input.advisoryGeneratedAt, "advisoryGeneratedAt"),
    periodStartAt: safeTime(input.periodStartAt, "periodStartAt"),
    observationIds,
    observations,
    ...(input.lastObservedAt === undefined ? {} : { lastObservedAt: safeTime(input.lastObservedAt, "lastObservedAt") }),
  } satisfies PersistedPaperRealizedPeriodPlan;
  if (!Number.isSafeInteger(plan.periodIndex) || plan.periodIndex < 0) throw new PaperRealizedPeriodProducerError("INVALID_PERIOD_INDEX", "periodIndex must be a non-negative safe integer", plan.periodId);
  if (!SHA256.test(plan.datasetContentSha256)) throw new PaperRealizedPeriodProducerError("INVALID_DATASET_PROVENANCE", "datasetContentSha256 must be a lowercase SHA-256 digest", plan.periodId);
  if (plan.advisoryGeneratedAt >= plan.periodStartAt) throw new PaperRealizedPeriodProducerError("LOOKAHEAD_ADVISORY", "advisory must predate the PAPER period", plan.periodId);
  if (new Set(plan.observationIds).size !== plan.observationIds.length || plan.observationIds.length > MAXIMUM_OBSERVATIONS) throw new PaperRealizedPeriodProducerError("INVALID_OBSERVATIONS", "period observations must be unique and bounded", plan.periodId);
  if (plan.lastObservedAt !== undefined && plan.lastObservedAt < plan.periodStartAt) throw new PaperRealizedPeriodProducerError("INVALID_OBSERVATION_TIME", "runtime observation predates the period start", plan.periodId);
  return freeze({ ...plan, observationIds: freeze(plan.observationIds), observations: freeze(plan.observations) });
}

function samePlanIdentity(left: PaperRealizedPeriodOpenInput, right: PaperRealizedPeriodOpenInput): boolean {
  return left.periodId === right.periodId
    && left.periodIndex === right.periodIndex
    && left.candidateId === right.candidateId
    && left.datasetId === right.datasetId
    && left.datasetContentSha256 === right.datasetContentSha256
    && left.advisoryGeneratedAt === right.advisoryGeneratedAt
    && left.periodStartAt === right.periodStartAt;
}

function validateEvidence(evidence: PaperForwardPeriodEvidence): PaperForwardPeriodEvidence {
  rejectForbiddenFields(evidence);
  const normalized = {
    periodId: safeText(evidence.periodId, "periodId"),
    candidateId: safeText(evidence.candidateId, "candidateId"),
    datasetId: safeText(evidence.datasetId, "datasetId"),
    datasetContentSha256: safeText(evidence.datasetContentSha256, "datasetContentSha256"),
    advisoryGeneratedAt: safeTime(evidence.advisoryGeneratedAt, "advisoryGeneratedAt"),
    periodStartAt: safeTime(evidence.periodStartAt, "periodStartAt"),
    periodEndAt: safeTime(evidence.periodEndAt, "periodEndAt"),
    grossReturn: finite(evidence.grossReturn, "grossReturn"),
    turnover: finite(evidence.turnover, "turnover"),
    feeRate: finite(evidence.feeRate, "feeRate"),
    spreadRate: finite(evidence.spreadRate, "spreadRate"),
    slippageRate: finite(evidence.slippageRate, "slippageRate"),
    status: evidence.status,
  } satisfies PaperForwardPeriodEvidence;
  if (!SHA256.test(normalized.datasetContentSha256)) throw new PaperRealizedPeriodProducerError("INVALID_DATASET_PROVENANCE", "datasetContentSha256 must be a lowercase SHA-256 digest", normalized.periodId);
  if (!PERIOD_STATUSES.has(normalized.status)) throw new PaperRealizedPeriodProducerError("INVALID_STATUS", "PAPER period status is unsupported", normalized.periodId);
  if (!(normalized.advisoryGeneratedAt < normalized.periodStartAt && normalized.periodStartAt < normalized.periodEndAt)) throw new PaperRealizedPeriodProducerError("INVALID_PERIOD_BOUNDS", "PAPER period chronology is invalid", normalized.periodId);
  if (normalized.turnover < 0 || normalized.feeRate < 0 || normalized.spreadRate < 0 || normalized.slippageRate < 0) throw new PaperRealizedPeriodProducerError("INVALID_COST_EVIDENCE", "PAPER period costs must be non-negative", normalized.periodId);
  return freeze(normalized);
}

function validateObservation(observation: PaperRuntimeObservation): PaperRuntimeObservation {
  rejectForbiddenFields(observation);
  const normalized = freeze({ observationId: safeText(observation.observationId, "observationId"), observedAt: safeTime(observation.observedAt, "observedAt"), status: observation.status });
  if (!OBSERVATION_STATUSES.has(normalized.status)) throw new PaperRealizedPeriodProducerError("INVALID_RUNTIME_OBSERVATION", "PAPER runtime observation status is unsupported");
  return normalized;
}

function decode<T>(row: { period_id?: unknown; payload_json?: unknown; checksum?: unknown }, validator: (value: T) => T, periodId: string): T {
  const payload = String(row.payload_json ?? "");
  try {
    const parsed = JSON.parse(payload) as T;
    if (digest(parsed) !== String(row.checksum ?? "")) throw new PaperRealizedPeriodProducerError("PERSISTED_CHECKSUM_MISMATCH", "PAPER period checksum mismatch", periodId);
    const validated = validator(parsed);
    if (String(row.period_id ?? "") !== periodId || (validated as { readonly periodId?: unknown }).periodId !== periodId) throw new PaperRealizedPeriodProducerError("PERSISTED_ROW_IDENTITY_MISMATCH", "PAPER period row identity mismatch", periodId);
    return validated;
  } catch (error) {
    if (error instanceof PaperRealizedPeriodProducerError) throw error;
    throw new PaperRealizedPeriodProducerError("MALFORMED_PERSISTED_PERIOD", "PAPER period payload is malformed", periodId);
  }
}

export class SqlitePaperRealizedPeriodRepository implements PaperRealizedPeriodRepository {
  public constructor(private readonly db: SqliteDatabase, private readonly maximumPeriods = DEFAULT_MAXIMUM_PERIODS) {
    if (!Number.isSafeInteger(maximumPeriods) || maximumPeriods < 1 || maximumPeriods > 1_000) throw new PaperRealizedPeriodProducerError("INVALID_RETENTION", "PAPER period retention must be between 1 and 1000");
    this.db.connection.exec(`CREATE TABLE IF NOT EXISTS ${TABLE} (period_id TEXT PRIMARY KEY, period_index INTEGER NOT NULL UNIQUE, lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('OPEN','REALIZED')), period_start_at INTEGER NOT NULL, period_end_at INTEGER, payload_json TEXT NOT NULL, checksum TEXT NOT NULL)`);
  }

  public open(plan: PersistedPaperRealizedPeriodPlan): PersistedPaperRealizedPeriodPlan {
    const normalized = validatePlan(plan);
    const payload = canonical(normalized);
    const checksum = digest(normalized);
    return this.db.transaction(() => {
      const existing = this.db.connection.prepare(`SELECT period_id, lifecycle_state, payload_json, checksum FROM ${TABLE} WHERE period_id = ?`).get(normalized.periodId) as { period_id?: string; lifecycle_state?: string; payload_json?: string; checksum?: string } | undefined;
      if (existing != null) {
        if (existing.lifecycle_state === "OPEN") {
          const stored = decode(existing, validatePlan, normalized.periodId);
          if (!samePlanIdentity(stored, normalized)) throw new PaperRealizedPeriodProducerError("PERIOD_ID_CONFLICT", "PAPER period identity was reused with different open evidence", normalized.periodId);
          return stored;
        }
        if (existing.lifecycle_state !== "REALIZED") throw new PaperRealizedPeriodProducerError("MALFORMED_PERSISTED_PERIOD", "PAPER period lifecycle state is invalid", normalized.periodId);
        const realized = decode<PaperForwardPeriodEvidence>(existing, validateEvidence, normalized.periodId);
        if (realized.candidateId !== normalized.candidateId || realized.datasetId !== normalized.datasetId || realized.datasetContentSha256 !== normalized.datasetContentSha256 || realized.advisoryGeneratedAt !== normalized.advisoryGeneratedAt || realized.periodStartAt !== normalized.periodStartAt) throw new PaperRealizedPeriodProducerError("PERIOD_ID_CONFLICT", "PAPER period was already realized with different provenance", normalized.periodId);
        throw new PaperRealizedPeriodProducerError("PERIOD_ALREADY_REALIZED", "PAPER period has already been realized", normalized.periodId);
      }
      const openConflict = this.db.connection.prepare(`SELECT period_id FROM ${TABLE} WHERE lifecycle_state = 'OPEN' LIMIT 1`).get() as { period_id?: string } | undefined;
      if (openConflict != null) throw new PaperRealizedPeriodProducerError("PERIOD_ALREADY_OPEN", "only one canonical PAPER realized period may be open at a time", normalized.periodId);
      const indexConflict = this.db.connection.prepare(`SELECT period_id FROM ${TABLE} WHERE period_index >= ? ORDER BY period_index ASC, period_id ASC LIMIT 1`).get(normalized.periodIndex) as { period_id?: string } | undefined;
      if (indexConflict != null) throw new PaperRealizedPeriodProducerError("PERIOD_INDEX_CONFLICT", "PAPER periodIndex must advance beyond retained history", normalized.periodId);
      this.db.connection.prepare(`INSERT INTO ${TABLE} (period_id, period_index, lifecycle_state, period_start_at, period_end_at, payload_json, checksum) VALUES (?, ?, 'OPEN', ?, NULL, ?, ?)`).run(normalized.periodId, normalized.periodIndex, normalized.periodStartAt, payload, checksum);
      return normalized;
    });
  }

  public observe(periodId: string, observation: PaperRuntimeObservation): PersistedPaperRealizedPeriodPlan {
    const id = safeText(periodId, "periodId");
    const normalizedObservation = validateObservation(observation);
    return this.db.transaction(() => {
      const row = this.db.connection.prepare(`SELECT period_id, lifecycle_state, payload_json, checksum FROM ${TABLE} WHERE period_id = ?`).get(id) as { period_id?: string; lifecycle_state?: string; payload_json?: string; checksum?: string } | undefined;
      if (row == null || row.lifecycle_state !== "OPEN") throw new PaperRealizedPeriodProducerError("PERIOD_NOT_OPEN", "PAPER period is not open", id);
      const current = decode(row, validatePlan, id);
      const existingObservation = current.observations.find((item) => item.observationId === normalizedObservation.observationId);
      if (existingObservation != null) {
        if (existingObservation.observedAt !== normalizedObservation.observedAt || existingObservation.status !== normalizedObservation.status) throw new PaperRealizedPeriodProducerError("OBSERVATION_ID_CONFLICT", "PAPER runtime observation identity was reused with different evidence", id);
        return current;
      }
      if (current.observationIds.length >= MAXIMUM_OBSERVATIONS) throw new PaperRealizedPeriodProducerError("OBSERVATION_LIMIT", "PAPER period observation limit reached", id);
      const next = validatePlan({ ...current, observationIds: [...current.observationIds, normalizedObservation.observationId], observations: [...current.observations, normalizedObservation], lastObservedAt: Math.max(current.lastObservedAt ?? 0, normalizedObservation.observedAt) });
      this.db.connection.prepare(`UPDATE ${TABLE} SET payload_json = ?, checksum = ? WHERE period_id = ? AND lifecycle_state = 'OPEN'`).run(canonical(next), digest(next), id);
      return next;
    });
  }

  public realize(evidence: PaperForwardPeriodEvidence): PaperForwardPeriodEvidence {
    const normalized = validateEvidence(evidence);
    const payload = canonical(normalized);
    const checksum = digest(normalized);
    return this.db.transaction(() => {
      const row = this.db.connection.prepare(`SELECT period_id, lifecycle_state, period_index, period_start_at, period_end_at, payload_json, checksum FROM ${TABLE} WHERE period_id = ?`).get(normalized.periodId) as { period_id?: string; lifecycle_state?: string; period_index?: number; period_start_at?: number; period_end_at?: number | null; payload_json?: string; checksum?: string } | undefined;
      if (row == null) throw new PaperRealizedPeriodProducerError("PERIOD_NOT_OPEN", "PAPER period was not opened by the producer", normalized.periodId);
      if (row.lifecycle_state === "REALIZED") {
        const existing = decode<PaperForwardPeriodEvidence>(row, validateEvidence, normalized.periodId);
        if (Number(row.period_start_at) !== existing.periodStartAt || Number(row.period_end_at) !== existing.periodEndAt) throw new PaperRealizedPeriodProducerError("PERSISTED_ROW_IDENTITY_MISMATCH", "PAPER period chronology columns do not match persisted evidence", normalized.periodId);
        if (canonical(existing) !== payload || String(row.checksum) !== checksum) throw new PaperRealizedPeriodProducerError("PERIOD_ID_CONFLICT", "realized PAPER period was reused with different outcome evidence", normalized.periodId);
        return existing;
      }
      if (row.lifecycle_state !== "OPEN") throw new PaperRealizedPeriodProducerError("MALFORMED_PERSISTED_PERIOD", "PAPER period lifecycle state is invalid", normalized.periodId);
      const plan = decode<PersistedPaperRealizedPeriodPlan>(row, validatePlan, normalized.periodId);
      if (plan.observationIds.length === 0) throw new PaperRealizedPeriodProducerError("PERIOD_OUTCOME_NOT_OBSERVED", "PAPER period cannot be realized without a runtime observation", normalized.periodId);
      if (plan.periodIndex !== Number(row.period_index) || plan.periodStartAt !== Number(row.period_start_at)) throw new PaperRealizedPeriodProducerError("PERSISTED_PLAN_IDENTITY_MISMATCH", "PAPER period plan row identity mismatch", normalized.periodId);
      if (plan.candidateId !== normalized.candidateId || plan.datasetId !== normalized.datasetId || plan.datasetContentSha256 !== normalized.datasetContentSha256 || plan.advisoryGeneratedAt !== normalized.advisoryGeneratedAt || plan.periodStartAt !== normalized.periodStartAt) throw new PaperRealizedPeriodProducerError("PROVENANCE_CONFLICT", "PAPER realized outcome does not match its open provenance", normalized.periodId);
      const chronologyConflict = this.db.connection.prepare(`SELECT period_id FROM ${TABLE} WHERE lifecycle_state = 'REALIZED' AND period_id <> ? AND ((period_index < ? AND period_end_at > ?) OR (period_index > ? AND period_start_at < ?)) LIMIT 1`).get(normalized.periodId, plan.periodIndex, plan.periodStartAt, plan.periodIndex, normalized.periodEndAt) as { period_id?: string } | undefined;
      if (chronologyConflict != null) throw new PaperRealizedPeriodProducerError("PERIOD_CHRONOLOGY_CONFLICT", `PAPER period chronology conflicts with ${String(chronologyConflict.period_id)}`, normalized.periodId);
      this.db.connection.prepare(`UPDATE ${TABLE} SET lifecycle_state = 'REALIZED', period_end_at = ?, payload_json = ?, checksum = ? WHERE period_id = ? AND lifecycle_state = 'OPEN'`).run(normalized.periodEndAt, payload, checksum, normalized.periodId);
      this.prune();
      return normalized;
    });
  }

  public getRealized(periodId: string): PaperForwardPeriodEvidence | undefined {
    const id = safeText(periodId, "periodId");
    const row = this.db.connection.prepare(`SELECT period_id, lifecycle_state, period_start_at, period_end_at, payload_json, checksum FROM ${TABLE} WHERE period_id = ?`).get(id) as { period_id?: string; lifecycle_state?: string; period_start_at?: number; period_end_at?: number | null; payload_json?: string; checksum?: string } | undefined;
    if (row == null || row.lifecycle_state !== "REALIZED") return undefined;
    const evidence = decode<PaperForwardPeriodEvidence>(row, validateEvidence, id);
    if (Number(row.period_start_at) !== evidence.periodStartAt || Number(row.period_end_at) !== evidence.periodEndAt) throw new PaperRealizedPeriodProducerError("PERSISTED_ROW_IDENTITY_MISMATCH", "PAPER period chronology columns do not match persisted evidence", id);
    return evidence;
  }

  public list(): readonly PaperForwardPeriodEvidence[] {
    const rows = this.db.connection.prepare(`SELECT period_id, lifecycle_state, period_start_at, period_end_at, payload_json, checksum FROM ${TABLE} WHERE lifecycle_state = 'REALIZED' ORDER BY period_index ASC, period_id ASC`).all() as Array<{ period_id?: string; lifecycle_state?: string; period_start_at?: number; period_end_at?: number | null; payload_json?: string; checksum?: string }>;
    return freeze(rows.map((row) => {
      const periodId = String(row.period_id ?? "");
      const evidence = decode<PaperForwardPeriodEvidence>(row, validateEvidence, periodId);
      if (Number(row.period_start_at) !== evidence.periodStartAt || Number(row.period_end_at) !== evidence.periodEndAt) throw new PaperRealizedPeriodProducerError("PERSISTED_ROW_IDENTITY_MISMATCH", "PAPER period chronology columns do not match persisted evidence", periodId);
      return evidence;
    }));
  }

  public listOpen(): readonly PersistedPaperRealizedPeriodPlan[] {
    const rows = this.db.connection.prepare(`SELECT period_id, lifecycle_state, payload_json, checksum FROM ${TABLE} WHERE lifecycle_state = 'OPEN' ORDER BY period_index ASC, period_id ASC`).all() as Array<{ period_id?: string; lifecycle_state?: string; payload_json?: string; checksum?: string }>;
    return freeze(rows.map((row) => decode<PersistedPaperRealizedPeriodPlan>(row, validatePlan, String(row.period_id ?? ""))));
  }

  private prune(): void {
    this.db.connection.prepare(`DELETE FROM ${TABLE} WHERE lifecycle_state = 'REALIZED' AND period_id NOT IN (SELECT period_id FROM ${TABLE} WHERE lifecycle_state = 'REALIZED' ORDER BY period_index DESC, period_id DESC LIMIT ?)`).run(this.maximumPeriods);
  }
}

export class PaperRealizedPeriodProducer {
  private readonly openPeriods = new Map<string, PersistedPaperRealizedPeriodPlan>();

  public constructor(private readonly repository: PaperRealizedPeriodRepository) {
    const plans = repository.listOpen();
    if (plans.length > 1) throw new PaperRealizedPeriodProducerError("MULTIPLE_OPEN_PERIODS", "multiple open PAPER realized periods are unsafe");
    for (const plan of plans) this.openPeriods.set(plan.periodId, plan);
  }

  public openPeriod(input: PaperRealizedPeriodOpenInput): PersistedPaperRealizedPeriodPlan {
    if ([...this.openPeriods.values()].some((plan) => plan.periodId !== input.periodId)) throw new PaperRealizedPeriodProducerError("PERIOD_ALREADY_OPEN", "only one canonical PAPER realized period may be open at a time", input.periodId);
    const plan = validatePlan({ ...input, schemaVersion: 1, observationIds: [], observations: [] });
    const stored = this.repository.open(plan);
    this.openPeriods.set(stored.periodId, stored);
    return stored;
  }

  public observeExecution(observation: PaperRuntimeObservation): "RECORDED" | "DUPLICATE" | "NO_ACTIVE_PERIOD" {
    const normalized = validateObservation(observation);
    if (this.openPeriods.size === 0) return "NO_ACTIVE_PERIOD";
    let duplicate = true;
    for (const [periodId, current] of this.openPeriods) {
      if (!current.observationIds.includes(normalized.observationId)) duplicate = false;
      const next = this.repository.observe(periodId, normalized);
      this.openPeriods.set(periodId, next);
    }
    return duplicate ? "DUPLICATE" : "RECORDED";
  }

  public closePeriod(input: PaperRealizedPeriodCloseInput): PaperForwardPeriodEvidence {
    const current = this.openPeriods.get(input.periodId);
    if (current == null) {
      const existing = this.repository.getRealized(input.periodId);
      if (existing != null && existing.periodEndAt === input.periodEndAt && existing.grossReturn === input.grossReturn && existing.turnover === input.turnover && existing.feeRate === input.feeRate && existing.spreadRate === input.spreadRate && existing.slippageRate === input.slippageRate && existing.status === input.status) return existing;
      if (existing != null) throw new PaperRealizedPeriodProducerError("PERIOD_ID_CONFLICT", "realized PAPER period was reused with different outcome evidence", input.periodId);
      throw new PaperRealizedPeriodProducerError("PERIOD_NOT_OPEN", "PAPER period is not open", input.periodId);
    }
    const evidence = validateEvidence({ ...input, candidateId: current.candidateId, datasetId: current.datasetId, datasetContentSha256: current.datasetContentSha256, advisoryGeneratedAt: current.advisoryGeneratedAt, periodStartAt: current.periodStartAt });
    const stored = this.repository.realize(evidence);
    this.openPeriods.delete(input.periodId);
    return stored;
  }

  public listRealizedPeriods(): readonly PaperForwardPeriodEvidence[] { return this.repository.list(); }
  public listOpenPeriods(): readonly PersistedPaperRealizedPeriodPlan[] { return freeze([...this.openPeriods.values()].sort((left, right) => left.periodIndex - right.periodIndex || left.periodId.localeCompare(right.periodId))); }
  public hasOpenPeriod(): boolean { return this.openPeriods.size > 0; }
}

export function paperExecutionObservationId(market: string, observedAt: number, status: string): string {
  return `paper-runtime:${digest({ market: market.trim().toUpperCase(), observedAt, status }).slice(0, 32)}`;
}
