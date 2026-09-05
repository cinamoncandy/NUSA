import type { PaperForwardPeriodEvidence } from "./paperForwardEvidence";

export type PaperForwardEvidenceStrength = "INSUFFICIENT" | "VERIFIED";

export interface PaperForwardEvidenceSource {
  readonly listPaperRealizedPeriods: () => readonly PaperForwardPeriodEvidence[];
}

export interface PaperForwardEvidenceAdmission {
  readonly schemaVersion: 1;
  readonly evidenceMode: "PAPER_SHADOW";
  readonly candidateId: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly strength: PaperForwardEvidenceStrength;
  readonly periodCount: number;
  readonly completedPeriodCount: number;
  readonly rejectedOrHaltedPeriodCount: number;
  readonly cumulativeNetReturn: number;
  readonly reasons: readonly string[];
}

export interface PaperForwardEvidenceAdmissionPolicy {
  readonly minimumLongitudinalPeriods: number;
  readonly minimumCompletedPeriods?: number;
}

export class PaperForwardEvidenceAdmissionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PaperForwardEvidenceAdmissionError";
  }
}

const DEFAULT_POLICY: PaperForwardEvidenceAdmissionPolicy = Object.freeze({ minimumLongitudinalPeriods: 30 });
const PAPER_FORWARD_STATUSES = new Set<PaperForwardPeriodEvidence["status"]>(["COMPLETED", "REJECTED", "HALTED"]);
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function finite(value: number, field: string): void {
  if (!Number.isFinite(value)) throw new PaperForwardEvidenceAdmissionError("NON_FINITE_VALUE", `${field} must be finite`);
}

function identifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new PaperForwardEvidenceAdmissionError("EMPTY_IDENTIFIER", `${field} is required`);
  return normalized;
}

/** Shared candidate-specific PAPER/shadow evidence admission. */
export function admitPaperForwardEvidence(
  periods: readonly PaperForwardPeriodEvidence[],
  policy: PaperForwardEvidenceAdmissionPolicy = DEFAULT_POLICY,
): PaperForwardEvidenceAdmission {
  if (!Number.isSafeInteger(policy.minimumLongitudinalPeriods) || policy.minimumLongitudinalPeriods < 1) {
    throw new PaperForwardEvidenceAdmissionError("INVALID_POLICY", "minimumLongitudinalPeriods must be a positive integer");
  }
  const minimumCompletedPeriods = policy.minimumCompletedPeriods ?? policy.minimumLongitudinalPeriods;
  if (!Number.isSafeInteger(minimumCompletedPeriods) || minimumCompletedPeriods < 1) {
    throw new PaperForwardEvidenceAdmissionError("INVALID_POLICY", "minimumCompletedPeriods must be a positive integer");
  }
  if (periods.length === 0) throw new PaperForwardEvidenceAdmissionError("EMPTY_EVIDENCE", "at least one PAPER forward period is required");

  const candidateId = identifier(periods[0]!.candidateId, "candidateId");
  const datasetId = identifier(periods[0]!.datasetId, "datasetId");
  const datasetContentSha256 = identifier(periods[0]!.datasetContentSha256, "datasetContentSha256");
  const seenPeriodIds = new Set<string>();
  let previousEndAt: number | undefined;
  let cumulativeEquity = 1;
  let completedPeriodCount = 0;
  let rejectedOrHaltedPeriodCount = 0;

  for (const period of periods) {
    const periodId = identifier(period.periodId, "periodId");
    if (seenPeriodIds.has(periodId)) throw new PaperForwardEvidenceAdmissionError("DUPLICATE_PERIOD", `duplicate PAPER period ${periodId}`);
    seenPeriodIds.add(periodId);
    if (identifier(period.candidateId, "candidateId") !== candidateId) {
      throw new PaperForwardEvidenceAdmissionError("CANDIDATE_IDENTITY_MISMATCH", "all PAPER periods must belong to the same candidate");
    }
    if (identifier(period.datasetId, "datasetId") !== datasetId || identifier(period.datasetContentSha256, "datasetContentSha256") !== datasetContentSha256) {
      throw new PaperForwardEvidenceAdmissionError("DATASET_PROVENANCE_MISMATCH", "all PAPER periods must preserve the candidate dataset provenance");
    }
    if (!PAPER_FORWARD_STATUSES.has(period.status)) {
      throw new PaperForwardEvidenceAdmissionError("INVALID_STATUS", "PAPER evidence status must be COMPLETED, REJECTED or HALTED");
    }
    for (const [field, value] of [
      ["advisoryGeneratedAt", period.advisoryGeneratedAt],
      ["periodStartAt", period.periodStartAt],
      ["periodEndAt", period.periodEndAt],
      ["grossReturn", period.grossReturn],
      ["turnover", period.turnover],
      ["feeRate", period.feeRate],
      ["spreadRate", period.spreadRate],
      ["slippageRate", period.slippageRate],
    ] as const) finite(value, field);
    if (!Number.isSafeInteger(period.advisoryGeneratedAt) || !Number.isSafeInteger(period.periodStartAt) || !Number.isSafeInteger(period.periodEndAt)) {
      throw new PaperForwardEvidenceAdmissionError("INVALID_TIMESTAMP", "PAPER evidence timestamps must be safe integers");
    }
    if (!(period.advisoryGeneratedAt < period.periodStartAt && period.periodStartAt < period.periodEndAt)) {
      throw new PaperForwardEvidenceAdmissionError("LOOK_AHEAD_EVIDENCE", "advisory must predate the realized PAPER period");
    }
    if (previousEndAt != null && period.periodStartAt < previousEndAt) {
      throw new PaperForwardEvidenceAdmissionError("NON_MONOTONIC_PERIODS", "PAPER periods must be chronological and non-overlapping");
    }
    if (period.turnover < 0 || period.feeRate < 0 || period.spreadRate < 0 || period.slippageRate < 0) {
      throw new PaperForwardEvidenceAdmissionError("INVALID_COST_EVIDENCE", "turnover and all execution cost rates must be non-negative");
    }

    if (period.status === "COMPLETED") {
      const cost = period.turnover * (period.feeRate + period.spreadRate + period.slippageRate);
      const netReturn = period.grossReturn - cost;
      if (!Number.isFinite(netReturn) || netReturn <= -1) {
        throw new PaperForwardEvidenceAdmissionError("INVALID_NET_RETURN", "cost-adjusted PAPER net return must be finite and greater than -100%");
      }
      cumulativeEquity *= 1 + netReturn;
      if (!Number.isFinite(cumulativeEquity)) {
        throw new PaperForwardEvidenceAdmissionError("INVALID_CUMULATIVE_RETURN", "cumulative PAPER return must remain finite");
      }
      completedPeriodCount += 1;
    } else {
      rejectedOrHaltedPeriodCount += 1;
    }
    previousEndAt = period.periodEndAt;
  }

  const reasons = ["PAPER_SHADOW_EVIDENCE_ONLY", "NO_EXECUTION_AUTHORITY"];
  const hasLongitudinalCoverage = periods.length >= policy.minimumLongitudinalPeriods;
  const hasCompletedEvidence = completedPeriodCount >= minimumCompletedPeriods;
  const strength: PaperForwardEvidenceStrength = hasLongitudinalCoverage && hasCompletedEvidence ? "VERIFIED" : "INSUFFICIENT";
  if (!hasLongitudinalCoverage) reasons.push("NARROW_LONGITUDINAL_EVIDENCE");
  if (!hasCompletedEvidence) reasons.push("INSUFFICIENT_COMPLETED_EVIDENCE");
  if (rejectedOrHaltedPeriodCount > 0) reasons.push("FAILED_PERIODS_RETAINED");

  return freeze({
    schemaVersion: 1,
    evidenceMode: "PAPER_SHADOW",
    candidateId,
    datasetId,
    datasetContentSha256,
    strength,
    periodCount: periods.length,
    completedPeriodCount,
    rejectedOrHaltedPeriodCount,
    cumulativeNetReturn: cumulativeEquity - 1,
    reasons: freeze([...new Set(reasons)].sort()),
  });
}

/**
 * Generic source form remains non-promotable until an explicit canonical reconciliation boundary
 * validates the server-owned source. Cloud production uses the persisted-period adapter instead.
 */
export function admitPaperForwardEvidenceFromSource(
  source: PaperForwardEvidenceSource,
  policy: PaperForwardEvidenceAdmissionPolicy = DEFAULT_POLICY,
): PaperForwardEvidenceAdmission {
  const admission = admitPaperForwardEvidence(source.listPaperRealizedPeriods(), policy);
  return freeze({
    ...admission,
    strength: "INSUFFICIENT",
    reasons: freeze([...new Set([...admission.reasons, "SOURCE_RECONCILIATION_UNVERIFIED"])].sort()),
  });
}
