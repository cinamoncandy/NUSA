import { createHash } from "node:crypto";
import {
  PersistedPaperPeriodStoreError,
  SqlitePersistedPaperPeriodStore,
  type PersistedPaperCandidateProvenance,
  type PersistedPaperPeriodEnvelope,
  type PersistedPaperPendingPeriod,
} from "../../../packages/storage/src/persistedPaperPeriodStore";
import type { LeagueCapitalAllocationAdvisory } from "../../../packages/contracts/src/leagueCapitalAllocation";

export interface PaperRealizedPeriodOpenInput {
  readonly periodId: string;
  readonly periodIndex: number;
  readonly advisory: LeagueCapitalAllocationAdvisory;
  readonly candidateProvenance: readonly PersistedPaperCandidateProvenance[];
  readonly periodStartAt: number;
}

export interface PersistedPaperRealizedPeriodPlan extends PaperRealizedPeriodOpenInput {
  readonly schemaVersion: 1;
  readonly observationIds: readonly string[];
  readonly observations: readonly PaperRuntimeObservation[];
  readonly lastObservedAt?: number;
}

export interface PaperRealizedPeriodCloseInput {
  readonly envelope: PersistedPaperPeriodEnvelope;
}

export interface PaperRuntimeObservation {
  readonly observationId: string;
  readonly observedAt: number;
  readonly status: "FILLED" | "WAIT" | "BLOCKED" | "REJECTED" | "FAILED" | "DUPLICATE";
}

export type PaperRealizedPeriodLifecycleEvent =
  | { readonly type: "PERIOD_OPEN"; readonly periodId: string; readonly occurredAt: number }
  | { readonly type: "PERIOD_REALIZED_PERSISTED"; readonly periodId: string; readonly occurredAt: number }
  | { readonly type: "PERIOD_REJECTED"; readonly periodId: string; readonly occurredAt: number; readonly reasonCode: string };

export interface PaperRealizedPeriodProducerOptions {
  readonly onLifecycleEvent?: (event: PaperRealizedPeriodLifecycleEvent) => void;
  readonly now?: () => number;
  readonly maximumPeriods?: number;
}

export class PaperRealizedPeriodProducerError extends Error {
  public constructor(readonly code: string, message: string, readonly periodId?: string) {
    super(message);
    this.name = "PaperRealizedPeriodProducerError";
  }
}

const SHA256 = /^[a-f0-9]{64}$/;
const FORBIDDEN_KEY = /(authorization|bearer|token|secret|password|api[_-]?key|access[_-]?key|private[_-]?key|cookie|jwt|nonce|signature|account[_-]?id|order[_-]?id|fill[_-]?id)/i;
const OBSERVATION_STATUSES = new Set<PaperRuntimeObservation["status"]>(["FILLED", "WAIT", "BLOCKED", "REJECTED", "FAILED", "DUPLICATE"]);
const MAXIMUM_OBSERVATIONS = 1_024;
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function canonical(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new PaperRealizedPeriodProducerError("NON_FINITE_VALUE", "PAPER period contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item, seen)).join(",")}]`;
  if (typeof value === "object") {
    if (seen.has(value)) throw new PaperRealizedPeriodProducerError("CYCLIC_INPUT", "PAPER period must be acyclic");
    seen.add(value);
    const result = `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item, seen)}`).join(",")}}`;
    seen.delete(value);
    return result;
  }
  throw new PaperRealizedPeriodProducerError("UNSUPPORTED_VALUE", "PAPER period contains an unsupported value");
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

function rejectForbidden(value: unknown, seen = new Set<object>()): void {
  if (value == null || typeof value !== "object") return;
  if (seen.has(value)) throw new PaperRealizedPeriodProducerError("CYCLIC_INPUT", "PAPER period must be acyclic");
  seen.add(value);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(key)) throw new PaperRealizedPeriodProducerError("FORBIDDEN_FIELD", "PAPER period contains a forbidden field");
    rejectForbidden(child, seen);
  }
  seen.delete(value);
}

function validateObservation(input: PaperRuntimeObservation): PaperRuntimeObservation {
  rejectForbidden(input);
  const observation = freeze({ observationId: safeText(input.observationId, "observationId"), observedAt: safeTime(input.observedAt, "observedAt"), status: input.status });
  if (!OBSERVATION_STATUSES.has(observation.status)) throw new PaperRealizedPeriodProducerError("INVALID_RUNTIME_OBSERVATION", "PAPER runtime observation status is unsupported");
  return observation;
}

function validatePlan(input: PersistedPaperRealizedPeriodPlan): PersistedPaperRealizedPeriodPlan {
  rejectForbidden(input);
  if (input.schemaVersion !== 1) throw new PaperRealizedPeriodProducerError("UNSUPPORTED_SCHEMA", "PAPER period schema is unsupported", input.periodId);
  const periodId = safeText(input.periodId, "periodId");
  const periodIndex = input.periodIndex;
  if (!Number.isSafeInteger(periodIndex) || periodIndex < 0) throw new PaperRealizedPeriodProducerError("INVALID_PERIOD_INDEX", "periodIndex must be a non-negative safe integer", periodId);
  const periodStartAt = safeTime(input.periodStartAt, "periodStartAt");
  const advisoryGeneratedAt = Date.parse(input.advisory.generatedAt);
  if (!Number.isFinite(advisoryGeneratedAt) || advisoryGeneratedAt >= periodStartAt) throw new PaperRealizedPeriodProducerError("LOOKAHEAD_ADVISORY", "advisory must predate the PAPER period", periodId);
  const candidateProvenance = [...input.candidateProvenance].map((item) => freeze({ candidateId: safeText(item.candidateId, "candidateId"), datasetId: safeText(item.datasetId, "datasetId"), datasetContentSha256: safeText(item.datasetContentSha256, "datasetContentSha256") })).sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  if (candidateProvenance.length === 0 || candidateProvenance.some((item) => !SHA256.test(item.datasetContentSha256))) throw new PaperRealizedPeriodProducerError("INVALID_DATASET_PROVENANCE", "candidate dataset provenance is incomplete", periodId);
  if (new Set(candidateProvenance.map((item) => item.candidateId)).size !== candidateProvenance.length) throw new PaperRealizedPeriodProducerError("INVALID_CANDIDATE_PROVENANCE", "candidate provenance identity is duplicated", periodId);
  const observationIds = [...input.observationIds].map((id) => safeText(id, "observationId"));
  const observations = [...input.observations].map(validateObservation);
  if (observationIds.length !== observations.length || observations.some((item, index) => item.observationId !== observationIds[index]) || observationIds.length > MAXIMUM_OBSERVATIONS || new Set(observationIds).size !== observationIds.length) throw new PaperRealizedPeriodProducerError("INVALID_OBSERVATIONS", "period observation identities are inconsistent or unbounded", periodId);
  const lastObservedAt = input.lastObservedAt === undefined ? undefined : safeTime(input.lastObservedAt, "lastObservedAt");
  const latestObservedAt = observations.reduce<number | undefined>((latest, item) => latest === undefined ? item.observedAt : Math.max(latest, item.observedAt), undefined);
  if (lastObservedAt !== undefined && latestObservedAt !== undefined && lastObservedAt !== latestObservedAt) throw new PaperRealizedPeriodProducerError("INVALID_OBSERVATION_TIME", "period observation timestamp is inconsistent", periodId);
  if (lastObservedAt !== undefined && lastObservedAt < periodStartAt) throw new PaperRealizedPeriodProducerError("INVALID_OBSERVATION_TIME", "runtime observation predates the period start", periodId);
  const plan = { schemaVersion: 1 as const, periodId, periodIndex, advisory: input.advisory, candidateProvenance, periodStartAt, observationIds, observations, ...(lastObservedAt === undefined ? {} : { lastObservedAt }) } satisfies PersistedPaperRealizedPeriodPlan;
  return freeze({ ...plan, candidateProvenance: freeze(candidateProvenance), observationIds: freeze(observationIds), observations: freeze(observations) });
}

function samePlanIdentity(left: PaperRealizedPeriodOpenInput, right: PaperRealizedPeriodOpenInput): boolean {
  return left.periodId === right.periodId
    && left.periodIndex === right.periodIndex
    && left.periodStartAt === right.periodStartAt
    && digest(left.advisory) === digest(right.advisory)
    && digest([...left.candidateProvenance].sort((a, b) => a.candidateId.localeCompare(b.candidateId))) === digest([...right.candidateProvenance].sort((a, b) => a.candidateId.localeCompare(b.candidateId)));
}

function validateEnvelope(envelope: PersistedPaperPeriodEnvelope): PersistedPaperPeriodEnvelope {
  rejectForbidden(envelope);
  const record = envelope.record;
  if (record == null || record.recordId == null) throw new PaperRealizedPeriodProducerError("INVALID_RECORD_ID", "PAPER realized record is missing");
  if (!Number.isSafeInteger(record.periodIndex) || record.periodIndex < 0) throw new PaperRealizedPeriodProducerError("INVALID_PERIOD_INDEX", "PAPER periodIndex is invalid", record.recordId);
  safeTime(record.periodStartAt, "periodStartAt"); safeTime(record.periodEndAt, "periodEndAt");
  if (!(Date.parse(record.advisory.generatedAt) < record.periodStartAt && record.periodStartAt < record.periodEndAt)) throw new PaperRealizedPeriodProducerError("INVALID_PERIOD_BOUNDS", "PAPER period chronology is invalid", record.recordId);
  if (!record.costEvidence || record.costEvidence.source !== "PAPER_EXECUTION_RECEIPT" || !safeText(record.costEvidence.evidenceId, "costEvidence.evidenceId")) throw new PaperRealizedPeriodProducerError("MISSING_COST_PROVENANCE", "PAPER realized period requires an attributable execution cost receipt", record.recordId);
  safeTime(record.costEvidence.observedAt, "costEvidence.observedAt");
  if (record.costEvidence.observedAt < record.periodStartAt) throw new PaperRealizedPeriodProducerError("INVALID_COST_EVIDENCE", "cost receipt must be observed during the PAPER period", record.recordId);
  for (const [field, value] of Object.entries({ benchmarkReturn: record.benchmarkReturn, turnoverCostRate: record.turnoverCostRate, ...record.realizedReturns, feeRate: record.costEvidence.feeRate, spreadRate: record.costEvidence.spreadRate, slippageRate: record.costEvidence.slippageRate })) if (typeof value !== "number" || !Number.isFinite(value)) throw new PaperRealizedPeriodProducerError("NON_FINITE_VALUE", `${field} must be finite`, record.recordId);
  if (record.turnoverCostRate < 0 || record.costEvidence.feeRate < 0 || record.costEvidence.spreadRate < 0 || record.costEvidence.slippageRate < 0) throw new PaperRealizedPeriodProducerError("INVALID_COST_EVIDENCE", "PAPER period costs must be non-negative", record.recordId);
  if (!(record.status === "COMPLETED" || record.status === "REJECTED" || record.status === "HALTED")) throw new PaperRealizedPeriodProducerError("INVALID_STATUS", "PAPER period status is unsupported", record.recordId);
  return freeze({ record: freeze({ ...record, realizedReturns: freeze({ ...record.realizedReturns }), costEvidence: freeze({ ...record.costEvidence }) }), candidateProvenance: freeze([...envelope.candidateProvenance].sort((a, b) => a.candidateId.localeCompare(b.candidateId)).map((item) => freeze({ ...item }))) });
}

function decodePlan(pending: PersistedPaperPendingPeriod): PersistedPaperRealizedPeriodPlan {
  try {
    if (digest(JSON.parse(pending.payloadJson)) !== pending.checksum) throw new PaperRealizedPeriodProducerError("PENDING_CHECKSUM_MISMATCH", "pending PAPER period checksum mismatch", pending.periodId);
    const plan = validatePlan(JSON.parse(pending.payloadJson) as PersistedPaperRealizedPeriodPlan);
    if (plan.periodId !== pending.periodId || plan.periodIndex !== pending.periodIndex || plan.periodStartAt !== pending.periodStartAt) throw new PaperRealizedPeriodProducerError("PENDING_IDENTITY_CONFLICT", "pending PAPER period identity mismatch", pending.periodId);
    return plan;
  } catch (error) {
    if (error instanceof PaperRealizedPeriodProducerError) throw error;
    throw new PaperRealizedPeriodProducerError("MALFORMED_PENDING_PERIOD", "pending PAPER period payload is malformed", pending.periodId);
  }
}

export class PaperRealizedPeriodProducer {
  private readonly openPeriods = new Map<string, PersistedPaperRealizedPeriodPlan>();

  public constructor(private readonly repository: SqlitePersistedPaperPeriodStore, private readonly options: PaperRealizedPeriodProducerOptions = {}) {
    if (options.maximumPeriods !== undefined && (!Number.isSafeInteger(options.maximumPeriods) || options.maximumPeriods < 1 || options.maximumPeriods > 1_000)) throw new PaperRealizedPeriodProducerError("INVALID_RETENTION", "PAPER period retention must be between 1 and 1000");
    const pending = repository.listPending().map(decodePlan);
    if (pending.length > 1) throw new PaperRealizedPeriodProducerError("MULTIPLE_OPEN_PERIODS", "multiple open PAPER realized periods are unsafe");
    for (const plan of pending) this.openPeriods.set(plan.periodId, plan);
    repository.prune(options.maximumPeriods ?? 100);
  }

  public openPeriod(input: PaperRealizedPeriodOpenInput): PersistedPaperRealizedPeriodPlan {
    try {
      if ([...this.openPeriods.values()].some((plan) => plan.periodId !== input.periodId)) throw new PaperRealizedPeriodProducerError("PERIOD_ALREADY_OPEN", "only one canonical PAPER realized period may be open at a time", input.periodId);
      const plan = validatePlan({ ...input, schemaVersion: 1, observationIds: [], observations: [] });
      const pending = { periodId: plan.periodId, periodIndex: plan.periodIndex, periodStartAt: plan.periodStartAt, payloadJson: canonical(plan), checksum: digest(plan) } satisfies PersistedPaperPendingPeriod;
      this.repository.putPending(pending);
      this.openPeriods.set(plan.periodId, plan);
      this.emit({ type: "PERIOD_OPEN", periodId: plan.periodId, occurredAt: plan.periodStartAt });
      return plan;
    } catch (error) { throw this.reject(error, input.periodId); }
  }

  public observeExecution(observation: PaperRuntimeObservation): "RECORDED" | "DUPLICATE" | "NO_ACTIVE_PERIOD" {
    const normalized = validateObservation(observation);
    if (this.openPeriods.size === 0) return "NO_ACTIVE_PERIOD";
    let duplicate = true;
    try {
      for (const [periodId, current] of this.openPeriods) {
        if (!current.observationIds.includes(normalized.observationId)) duplicate = false;
        const pending = this.repository.getPending(periodId);
        if (pending == null) throw new PaperRealizedPeriodProducerError("PERIOD_NOT_OPEN", "PAPER period is not open", periodId);
        const stored = decodePlan(pending);
        if (!samePlanIdentity(stored, current)) throw new PaperRealizedPeriodProducerError("PENDING_IDENTITY_CONFLICT", "pending PAPER period changed during observation", periodId);
        const existing = current.observations.find((item) => item.observationId === normalized.observationId);
        if (existing != null) {
          if (existing.observedAt !== normalized.observedAt || existing.status !== normalized.status) throw new PaperRealizedPeriodProducerError("OBSERVATION_ID_CONFLICT", "PAPER runtime observation identity was reused with different evidence", periodId);
          continue;
        }
        if (current.observationIds.length >= MAXIMUM_OBSERVATIONS) throw new PaperRealizedPeriodProducerError("OBSERVATION_LIMIT", "PAPER period observation limit reached", periodId);
        const next = validatePlan({ ...current, observationIds: [...current.observationIds, normalized.observationId], observations: [...current.observations, normalized], lastObservedAt: Math.max(current.lastObservedAt ?? 0, normalized.observedAt) });
        this.repository.updatePending({ ...pending, payloadJson: canonical(next), checksum: digest(next) });
        this.openPeriods.set(periodId, next);
      }
      return duplicate ? "DUPLICATE" : "RECORDED";
    } catch (error) { throw this.reject(error); }
  }

  public closePeriod(input: PaperRealizedPeriodCloseInput): PersistedPaperPeriodEnvelope {
    const periodId = input.envelope.record.recordId;
    try {
      const envelope = validateEnvelope(input.envelope);
      const current = this.openPeriods.get(periodId);
      if (current == null) {
        const existing = this.repository.list().find((item) => item.record.recordId === periodId);
        if (existing != null && canonical(existing) === canonical(envelope)) return existing;
        if (existing != null) throw new PaperRealizedPeriodProducerError("PERIOD_ID_CONFLICT", "realized PAPER period was reused with different evidence", periodId);
        throw new PaperRealizedPeriodProducerError("PERIOD_NOT_OPEN", "PAPER period is not open", periodId);
      }
      if (current.observationIds.length === 0) throw new PaperRealizedPeriodProducerError("PERIOD_OUTCOME_NOT_OBSERVED", "PAPER period cannot be realized without a runtime observation", periodId);
      if (!samePlanIdentity(current, { periodId: envelope.record.recordId, periodIndex: envelope.record.periodIndex, advisory: envelope.record.advisory, candidateProvenance: envelope.candidateProvenance, periodStartAt: envelope.record.periodStartAt })) throw new PaperRealizedPeriodProducerError("PROVENANCE_CONFLICT", "realized PAPER outcome does not match its open candidate/advisory provenance", periodId);
      const pending = this.repository.getPending(periodId);
      if (pending == null) throw new PaperRealizedPeriodProducerError("PERIOD_NOT_OPEN", "PAPER period is not open", periodId);
      const stored = this.repository.finalizePending(periodId, pending.checksum, envelope);
      this.repository.prune(this.options.maximumPeriods ?? 100);
      this.openPeriods.delete(periodId);
      this.emit({ type: "PERIOD_REALIZED_PERSISTED", periodId, occurredAt: envelope.record.periodEndAt });
      return stored;
    } catch (error) { throw this.reject(error, periodId); }
  }

  public listRealizedPeriods(): readonly PersistedPaperPeriodEnvelope[] {
    try { return this.repository.list(); }
    catch (error) { throw this.reject(error); }
  }
  public listOpenPeriods(): readonly PersistedPaperRealizedPeriodPlan[] { return freeze([...this.openPeriods.values()].sort((left, right) => left.periodIndex - right.periodIndex || left.periodId.localeCompare(right.periodId))); }
  public hasOpenPeriod(): boolean { return this.openPeriods.size > 0; }

  private emit(event: PaperRealizedPeriodLifecycleEvent): void { try { this.options.onLifecycleEvent?.(event); } catch { /* lifecycle telemetry cannot alter PAPER execution */ } }
  private reject(error: unknown, periodId?: string): PaperRealizedPeriodProducerError {
    const normalized = error instanceof PaperRealizedPeriodProducerError ? error : error instanceof PersistedPaperPeriodStoreError ? new PaperRealizedPeriodProducerError(error.code, error.message, error.recordId ?? periodId) : new PaperRealizedPeriodProducerError("PAPER_PERIOD_REJECTED", "PAPER realized period evidence was rejected", periodId);
    this.emit({ type: "PERIOD_REJECTED", periodId: normalized.periodId ?? periodId ?? "unknown", occurredAt: this.options.now?.() ?? Date.now(), reasonCode: normalized.code });
    return normalized;
  }
}

export { SqlitePersistedPaperPeriodStore as SqlitePaperRealizedPeriodRepository };

export function paperExecutionObservationId(market: string, observedAt: number, status: string): string {
  return `paper-runtime:${digest({ market: market.trim().toUpperCase(), observedAt, status }).slice(0, 32)}`;
}
