import type { PersistedPaperPeriodEnvelope } from "../../../../packages/contracts/src/persistedPaperPeriod";
import { adaptPersistedPaperPeriods } from "./persistedPaperPeriodAdapter";
import {
  admitPaperForwardEvidence,
  type PaperForwardEvidenceAdmission,
  type PaperForwardEvidenceAdmissionPolicy,
  type PaperForwardEvidenceSource,
} from "./paperForwardEvidenceAdmission";
import type { PaperForwardPeriodEvidence } from "../../../../packages/contracts/src/paperForwardEvidence";
import { evaluateShadowAllocation, type ShadowAllocationPeriodInput } from "./shadowAllocationEvaluation";

const SHA256 = /^[a-f0-9]{64}$/;
const COST_TOLERANCE = 1e-12;
const FORBIDDEN_KEY = /(authorization|bearer|token|secret|password|api[_-]?key|access[_-]?key|private[_-]?key|cookie|jwt|nonce|signature|account[_-]?id|order[_-]?id|fill[_-]?id)/i;
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

export class PersistedPaperForwardEvidenceAdapterError extends Error {
  public constructor(readonly code: string, message: string, readonly recordId?: string, readonly candidateId?: string) {
    super(message);
    this.name = "PersistedPaperForwardEvidenceAdapterError";
  }
}

/**
 * Candidate-bound projection produced from the authoritative persisted PAPER-period store.
 * `admission` is deliberately the only research result produced here: this adapter does not
 * invent a PaperPerformanceSummary for metrics (trade count, execution quality, etc.) that the
 * persisted period contract does not actually carry.
 */
export interface PersistedPaperForwardCandidateEvidence extends PaperForwardEvidenceSource {
  readonly candidateId: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly periods: readonly PaperForwardPeriodEvidence[];
  readonly admission: PaperForwardEvidenceAdmission;
}

export interface PersistedPaperForwardEvidenceAdapterResult {
  readonly candidates: readonly PersistedPaperForwardCandidateEvidence[];
  readonly orderedRecordIds: readonly string[];
}

function rejectForbidden(value: unknown, seen = new Set<object>()): void {
  if (value == null || typeof value !== "object") return;
  if (seen.has(value)) throw new PersistedPaperForwardEvidenceAdapterError("CYCLIC_INPUT", "persisted PAPER evidence must be acyclic");
  seen.add(value);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(key)) throw new PersistedPaperForwardEvidenceAdapterError("FORBIDDEN_FIELD", "persisted PAPER evidence contains a forbidden field");
    rejectForbidden(child, seen);
  }
  seen.delete(value);
}

function orderedRecords(envelopes: readonly PersistedPaperPeriodEnvelope[]): readonly PersistedPaperPeriodEnvelope[] {
  const records = [...envelopes].sort((left, right) => left.record.periodIndex - right.record.periodIndex || left.record.periodStartAt - right.record.periodStartAt || left.record.recordId.localeCompare(right.record.recordId));
  const seenIndices = new Set<number>();
  for (const envelope of records) {
    const record = envelope.record;
    if (seenIndices.has(record.periodIndex)) throw new PersistedPaperForwardEvidenceAdapterError("DUPLICATE_PERIOD_INDEX", `periodIndex ${record.periodIndex} appears more than once`, record.recordId);
    seenIndices.add(record.periodIndex);
  }
  return freeze(records);
}

function candidateIdentities(envelope: PersistedPaperPeriodEnvelope): ReadonlyMap<string, { readonly datasetId: string; readonly datasetContentSha256: string }> {
  const record = envelope.record;
  const advisoryIds = new Set(record.advisory.entries.map((entry) => entry.id));
  const realizedIds = new Set(Object.keys(record.realizedReturns));
  const identities = new Map<string, { readonly datasetId: string; readonly datasetContentSha256: string }>();
  for (const provenance of envelope.candidateProvenance) {
    const candidateId = provenance.candidateId.trim();
    const datasetId = provenance.datasetId.trim();
    if (!candidateId || !datasetId || !SHA256.test(provenance.datasetContentSha256)) {
      throw new PersistedPaperForwardEvidenceAdapterError("INVALID_DATASET_PROVENANCE", "candidate dataset provenance is incomplete", record.recordId, candidateId || undefined);
    }
    if (!advisoryIds.has(candidateId) || !realizedIds.has(candidateId)) {
      throw new PersistedPaperForwardEvidenceAdapterError("CANDIDATE_PROVENANCE_LINK_MISSING", `candidate ${candidateId} is not linked to the advisory and realized return`, record.recordId, candidateId);
    }
    const entry = record.advisory.entries.find((item) => item.id === candidateId);
    if (entry == null || !entry.sourceDatasetIds.includes(datasetId) || !record.advisory.provenance.sourceDatasetIds.includes(datasetId)) {
      throw new PersistedPaperForwardEvidenceAdapterError("DATASET_PROVENANCE_LINK_MISSING", `candidate ${candidateId} dataset provenance is not present in the advisory`, record.recordId, candidateId);
    }
    if (identities.has(candidateId)) throw new PersistedPaperForwardEvidenceAdapterError("DUPLICATE_CANDIDATE_PROVENANCE", `candidate ${candidateId} provenance appears twice`, record.recordId, candidateId);
    identities.set(candidateId, freeze({ datasetId, datasetContentSha256: provenance.datasetContentSha256 }));
  }
  if (identities.size !== advisoryIds.size || identities.size !== realizedIds.size) {
    throw new PersistedPaperForwardEvidenceAdapterError("CANDIDATE_PROVENANCE_SET_MISMATCH", `record ${record.recordId} has an incomplete candidate provenance set`, record.recordId);
  }
  return identities;
}

function turnoverByCandidate(periods: readonly ShadowAllocationPeriodInput[], evaluated: ReturnType<typeof evaluateShadowAllocation>): readonly Readonly<Record<string, number>>[] {
  const previous = new Map<string, number>();
  return freeze(periods.map((period, index) => {
    const current = new Map(period.advisory.entries.map((entry) => [entry.id, entry.researchWeight] as const));
    const ids = [...new Set([...previous.keys(), ...current.keys()])].sort();
    const byCandidate: Record<string, number> = {};
    let total = 0;
    for (const id of ids) {
      const value = Math.abs((current.get(id) ?? 0) - (previous.get(id) ?? 0)) / 2;
      if (!Number.isFinite(value)) throw new PersistedPaperForwardEvidenceAdapterError("NON_FINITE_TURNOVER", `candidate ${id} turnover is non-finite`);
      byCandidate[id] = value;
      total += value;
    }
    const expected = evaluated.periods[index]?.turnover;
    if (expected == null || Math.abs(total - expected) > COST_TOLERANCE) {
      throw new PersistedPaperForwardEvidenceAdapterError("TURNOVER_RECONCILIATION_MISMATCH", `period ${period.periodIndex} turnover could not be reconciled`);
    }
    previous.clear();
    for (const [id, weight] of current) previous.set(id, weight);
    return freeze(byCandidate);
  }));
}

/**
 * Converts persisted realized PAPER periods into one candidate-specific source per stable
 * candidate set. A changing candidate set is rejected rather than allowing survivorship through
 * per-candidate filtering. The existing shadow evaluator remains the source of allocation
 * turnover validation; this module only attributes that validated turnover deterministically.
 */
export function adaptPersistedPaperForwardEvidence(
  envelopes: readonly PersistedPaperPeriodEnvelope[],
  policy?: PaperForwardEvidenceAdmissionPolicy,
): PersistedPaperForwardEvidenceAdapterResult {
  if (envelopes.length === 0) throw new PersistedPaperForwardEvidenceAdapterError("EMPTY_EVIDENCE", "persisted PAPER evidence is empty");
  for (const envelope of envelopes) rejectForbidden(envelope);
  const ordered = orderedRecords(envelopes);
  const records = ordered.map((envelope) => envelope.record);
  const adapted = adaptPersistedPaperPeriods(records);
  if (adapted.periods.length !== records.length) throw new PersistedPaperForwardEvidenceAdapterError("UNEXPECTED_REPLAY_FILTER", "persisted PAPER evidence was unexpectedly filtered");
  const shadowPeriods = adapted.periods;
  const evaluation = evaluateShadowAllocation(shadowPeriods);
  const turnover = turnoverByCandidate(shadowPeriods, evaluation);
  const firstIdentities = candidateIdentities(ordered[0]!);
  const candidateIds = [...firstIdentities.keys()].sort();
  const periodsByCandidate = new Map(candidateIds.map((candidateId) => [candidateId, [] as PaperForwardPeriodEvidence[]] as const));

  ordered.forEach((envelope, index) => {
    const identities = candidateIdentities(envelope);
    const ids = [...identities.keys()].sort();
    if (ids.length !== candidateIds.length || ids.some((id, candidateIndex) => id !== candidateIds[candidateIndex])) {
      throw new PersistedPaperForwardEvidenceAdapterError("CANDIDATE_SET_DRIFT", `candidate set changed in period ${envelope.record.recordId}`, envelope.record.recordId);
    }
    for (const candidateId of candidateIds) {
      const expected = firstIdentities.get(candidateId)!;
      const current = identities.get(candidateId)!;
      if (current.datasetId !== expected.datasetId || current.datasetContentSha256 !== expected.datasetContentSha256) {
        throw new PersistedPaperForwardEvidenceAdapterError("DATASET_PROVENANCE_MISMATCH", `candidate ${candidateId} dataset provenance changed across PAPER periods`, envelope.record.recordId, candidateId);
      }
      const record = envelope.record;
      const costEvidence = record.costEvidence;
      const costRate = costEvidence.feeRate + costEvidence.spreadRate + costEvidence.slippageRate;
      if (Math.abs(record.turnoverCostRate - costRate) > COST_TOLERANCE) {
        throw new PersistedPaperForwardEvidenceAdapterError("COST_RATE_RECONCILIATION_MISMATCH", `period ${record.recordId} turnover cost rate does not match execution cost evidence`, record.recordId, candidateId);
      }
      const advisoryGeneratedAt = Date.parse(record.advisory.generatedAt);
      if (!Number.isSafeInteger(advisoryGeneratedAt)) throw new PersistedPaperForwardEvidenceAdapterError("INVALID_ADVISORY_TIMESTAMP", `period ${record.recordId} advisory timestamp is invalid`, record.recordId, candidateId);
      const grossReturn = record.realizedReturns[candidateId];
      if (grossReturn == null || !Number.isFinite(grossReturn)) throw new PersistedPaperForwardEvidenceAdapterError("MISSING_REALIZED_RETURN", `period ${record.recordId} has no finite realized return for ${candidateId}`, record.recordId, candidateId);
      periodsByCandidate.get(candidateId)!.push(freeze({
        periodId: record.recordId,
        candidateId,
        datasetId: expected.datasetId,
        datasetContentSha256: expected.datasetContentSha256,
        advisoryGeneratedAt,
        periodStartAt: record.periodStartAt,
        periodEndAt: record.periodEndAt,
        grossReturn,
        turnover: turnover[index]![candidateId] ?? 0,
        feeRate: costEvidence.feeRate,
        spreadRate: costEvidence.spreadRate,
        slippageRate: costEvidence.slippageRate,
        status: record.status,
      }));
    }
  });

  const candidates = candidateIds.map((candidateId) => {
    const identity = firstIdentities.get(candidateId)!;
    const periods = freeze(periodsByCandidate.get(candidateId)!);
    const admission = admitPaperForwardEvidence(periods, policy);
    return freeze({
      candidateId,
      datasetId: identity.datasetId,
      datasetContentSha256: identity.datasetContentSha256,
      periods,
      admission,
      listPaperRealizedPeriods: () => periods,
    });
  });
  return freeze({ candidates: freeze(candidates), orderedRecordIds: freeze(ordered.map((envelope) => envelope.record.recordId)) });
}
