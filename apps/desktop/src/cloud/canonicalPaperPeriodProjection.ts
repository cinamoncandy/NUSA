import { createHash } from "node:crypto";
import type { LeagueCapitalAllocationAdvisory } from "./leagueCapitalAllocation";
import type { PaperCandidateExecutionBindingReceipt } from "./paperCandidateExecutionBinding";
import type {
  PersistedPaperCandidateProvenance,
  PersistedPaperPeriodEnvelope,
} from "./persistedPaperPeriodStore";
import type { PaperExecutionCostEvidence } from "../../../../packages/contracts/src/persistedPaperPeriod";

export interface CanonicalPaperCandidateOutcome {
  readonly candidateId: string;
  readonly binding: PaperCandidateExecutionBindingReceipt;
  readonly grossReturn: number;
}

export interface CanonicalPaperRealizedPeriodInput {
  readonly periodIndex: number;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly advisory: LeagueCapitalAllocationAdvisory;
  readonly candidateProvenance: readonly PersistedPaperCandidateProvenance[];
  readonly outcomes: readonly CanonicalPaperCandidateOutcome[];
  readonly benchmarkReturn: number;
  readonly turnoverCostRate: number;
  readonly costEvidence: PaperExecutionCostEvidence;
  readonly status: "COMPLETED" | "REJECTED" | "HALTED";
}

export class CanonicalPaperPeriodProjectionError extends Error {
  public constructor(readonly code: string, message: string, readonly candidateId?: string) {
    super(message);
    this.name = "CanonicalPaperPeriodProjectionError";
  }
}

const SHA256 = /^[a-f0-9]{64}$/;
const COST_TOLERANCE = 1e-12;
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new CanonicalPaperPeriodProjectionError("NON_FINITE_VALUE", "canonical PAPER period contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  throw new CanonicalPaperPeriodProjectionError("UNSUPPORTED_VALUE", "canonical PAPER period contains an unsupported value");
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function safeTimestamp(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new CanonicalPaperPeriodProjectionError("INVALID_TIMESTAMP", `${field} must be a non-negative safe integer`);
  return value;
}

/**
 * Projects one already-realized canonical PAPER interval into the existing #885 envelope.
 * This boundary does not infer execution costs or candidate identity. It accepts only exact
 * pre-period binding receipts and complete cost evidence; persistence/replay remains owned by
 * SqlitePersistedPaperPeriodStore.
 */
export function projectCanonicalPaperRealizedPeriod(input: CanonicalPaperRealizedPeriodInput): PersistedPaperPeriodEnvelope {
  if (!Number.isSafeInteger(input.periodIndex) || input.periodIndex < 0) throw new CanonicalPaperPeriodProjectionError("INVALID_PERIOD_INDEX", "periodIndex must be a non-negative safe integer");
  const periodStartAt = safeTimestamp(input.periodStartAt, "periodStartAt");
  const periodEndAt = safeTimestamp(input.periodEndAt, "periodEndAt");
  if (periodStartAt >= periodEndAt) throw new CanonicalPaperPeriodProjectionError("INVALID_PERIOD_BOUNDS", "PAPER period must have positive duration");

  const advisoryGeneratedAt = Date.parse(input.advisory.generatedAt);
  if (!Number.isSafeInteger(advisoryGeneratedAt) || advisoryGeneratedAt >= periodStartAt) {
    throw new CanonicalPaperPeriodProjectionError("LOOKAHEAD_ADVISORY", "League advisory must be generated strictly before the PAPER period");
  }
  const advisoryFingerprintSha256 = digest(input.advisory);
  const advisoryIds = [...input.advisory.entries.map((entry) => entry.id)].sort();
  if (new Set(advisoryIds).size !== advisoryIds.length) throw new CanonicalPaperPeriodProjectionError("DUPLICATE_ADVISORY_CANDIDATE", "League advisory candidate IDs must be unique");

  const provenanceByCandidate = new Map<string, PersistedPaperCandidateProvenance>();
  for (const provenance of input.candidateProvenance) {
    if (!provenance.candidateId.trim() || !provenance.datasetId.trim() || !SHA256.test(provenance.datasetContentSha256)) {
      throw new CanonicalPaperPeriodProjectionError("INVALID_CANDIDATE_PROVENANCE", "candidate provenance is incomplete", provenance.candidateId);
    }
    if (provenanceByCandidate.has(provenance.candidateId)) throw new CanonicalPaperPeriodProjectionError("DUPLICATE_CANDIDATE_PROVENANCE", "candidate provenance must be unique", provenance.candidateId);
    provenanceByCandidate.set(provenance.candidateId, provenance);
  }

  const realizedReturns: Record<string, number> = {};
  for (const outcome of input.outcomes) {
    const candidateId = outcome.candidateId.trim();
    if (!candidateId || !Number.isFinite(outcome.grossReturn)) throw new CanonicalPaperPeriodProjectionError("INVALID_CANDIDATE_OUTCOME", "candidate outcome is incomplete", candidateId || undefined);
    if (Object.prototype.hasOwnProperty.call(realizedReturns, candidateId)) throw new CanonicalPaperPeriodProjectionError("DUPLICATE_CANDIDATE_OUTCOME", "candidate outcome must be unique", candidateId);
    const binding = outcome.binding;
    const provenance = provenanceByCandidate.get(candidateId);
    if (binding.status !== "BOUND_UNVERIFIED" || binding.authority !== "PAPER_RESEARCH_ONLY" || binding.liveAuthority !== "NONE" || binding.productionMutationAllowed !== false) {
      throw new CanonicalPaperPeriodProjectionError("INVALID_BINDING_AUTHORITY", "candidate binding does not preserve PAPER-only authority", candidateId);
    }
    if (binding.candidateId !== candidateId || binding.periodStartAt !== periodStartAt || binding.advisoryGeneratedAt !== advisoryGeneratedAt || binding.advisoryFingerprintSha256 !== advisoryFingerprintSha256) {
      throw new CanonicalPaperPeriodProjectionError("CANDIDATE_BINDING_MISMATCH", "candidate binding does not match this exact PAPER period/advisory", candidateId);
    }
    if (!SHA256.test(binding.bindingFingerprintSha256)) throw new CanonicalPaperPeriodProjectionError("INVALID_BINDING_FINGERPRINT", "candidate binding fingerprint is invalid", candidateId);
    if (provenance == null || binding.datasetId !== provenance.datasetId || binding.datasetContentSha256 !== provenance.datasetContentSha256) {
      throw new CanonicalPaperPeriodProjectionError("CANDIDATE_PROVENANCE_MISMATCH", "candidate binding does not match persisted dataset provenance", candidateId);
    }
    realizedReturns[candidateId] = outcome.grossReturn;
  }

  const realizedIds = Object.keys(realizedReturns).sort();
  if (realizedIds.length !== advisoryIds.length || realizedIds.some((id, index) => id !== advisoryIds[index])) {
    throw new CanonicalPaperPeriodProjectionError("CANDIDATE_SET_MISMATCH", "realized candidate set must exactly match the pre-period advisory");
  }
  if (provenanceByCandidate.size !== advisoryIds.length || advisoryIds.some((id) => !provenanceByCandidate.has(id))) {
    throw new CanonicalPaperPeriodProjectionError("CANDIDATE_PROVENANCE_SET_MISMATCH", "candidate provenance set must exactly match the pre-period advisory");
  }

  const cost = input.costEvidence;
  if (cost.source !== "PAPER_EXECUTION_RECEIPT" || !Number.isSafeInteger(cost.observedAt) || cost.observedAt < periodStartAt || cost.observedAt > periodEndAt) {
    throw new CanonicalPaperPeriodProjectionError("INVALID_COST_PROVENANCE", "execution cost evidence must be a realized PAPER execution receipt inside the period");
  }
  for (const value of [cost.feeRate, cost.spreadRate, cost.slippageRate, input.turnoverCostRate]) {
    if (!Number.isFinite(value) || value < 0) throw new CanonicalPaperPeriodProjectionError("INVALID_COST_EVIDENCE", "all PAPER execution cost rates must be finite and non-negative");
  }
  if (Math.abs(input.turnoverCostRate - (cost.feeRate + cost.spreadRate + cost.slippageRate)) > COST_TOLERANCE) {
    throw new CanonicalPaperPeriodProjectionError("COST_RECONCILIATION_MISMATCH", "turnoverCostRate must exactly reconcile to execution cost evidence");
  }
  if (!Number.isFinite(input.benchmarkReturn)) throw new CanonicalPaperPeriodProjectionError("INVALID_BENCHMARK_RETURN", "benchmarkReturn must be finite");

  const recordIdentity = {
    periodIndex: input.periodIndex,
    periodStartAt,
    periodEndAt,
    advisoryFingerprintSha256,
    bindingFingerprints: input.outcomes.map((outcome) => outcome.binding.bindingFingerprintSha256).sort(),
  };
  const recordId = `paper-period-${digest(recordIdentity)}`;
  return freeze({
    record: freeze({
      recordId,
      periodIndex: input.periodIndex,
      periodStartAt,
      periodEndAt,
      advisory: input.advisory,
      realizedReturns: freeze(realizedReturns),
      benchmarkReturn: input.benchmarkReturn,
      turnoverCostRate: input.turnoverCostRate,
      costEvidence: input.costEvidence,
      status: input.status,
    }),
    candidateProvenance: freeze(input.candidateProvenance.map((item) => freeze({ ...item }))),
  });
}
