import type { EvidenceConfidence } from "./opportunityPlanner";

export interface ConcurrencyEvidence {
  readonly source: string;
  readonly confidence: EvidenceConfidence;
  readonly currentWip: number;
  readonly maxWip: number;
  readonly throughputTrend: number;
  readonly conflictRate: number;
  readonly reworkRate: number;
  readonly ciUtilization: number;
}

export type ConcurrencyAction = "HOLD" | "INCREASE_BY_ONE" | "DECREASE_BY_ONE";

export interface ConcurrencyRecommendation {
  readonly action: ConcurrencyAction;
  readonly recommendedWip: number;
  readonly reason: string;
  readonly mutationAllowed: false;
}

const finite = (value: number): boolean => Number.isFinite(value);
const boundedRate = (value: number): boolean => finite(value) && value >= 0 && value <= 1;
const positiveInteger = (value: number): boolean => Number.isInteger(value) && value > 0;

export function adviseConcurrency(evidence: ConcurrencyEvidence): ConcurrencyRecommendation {
  const valid =
    evidence.confidence === "VERIFIED" &&
    positiveInteger(evidence.currentWip) &&
    positiveInteger(evidence.maxWip) &&
    evidence.currentWip <= evidence.maxWip &&
    finite(evidence.throughputTrend) &&
    boundedRate(evidence.conflictRate) &&
    boundedRate(evidence.reworkRate) &&
    boundedRate(evidence.ciUtilization);

  if (!valid) {
    return Object.freeze({
      action: "HOLD",
      recommendedWip: positiveInteger(evidence.currentWip) ? evidence.currentWip : 1,
      reason: "insufficient-or-invalid-evidence",
      mutationAllowed: false,
    });
  }

  const pressureHigh =
    evidence.conflictRate > 0.15 || evidence.reworkRate > 0.15 || evidence.ciUtilization > 0.85;

  if (pressureHigh && evidence.currentWip > 1) {
    return Object.freeze({
      action: "DECREASE_BY_ONE",
      recommendedWip: evidence.currentWip - 1,
      reason: "verified-contention-or-capacity-pressure",
      mutationAllowed: false,
    });
  }

  const headroomVerified =
    evidence.throughputTrend > 0 &&
    evidence.conflictRate <= 0.05 &&
    evidence.reworkRate <= 0.05 &&
    evidence.ciUtilization <= 0.7;

  if (headroomVerified && evidence.currentWip < evidence.maxWip) {
    return Object.freeze({
      action: "INCREASE_BY_ONE",
      recommendedWip: evidence.currentWip + 1,
      reason: "verified-throughput-gain-with-capacity-headroom",
      mutationAllowed: false,
    });
  }

  return Object.freeze({
    action: "HOLD",
    recommendedWip: evidence.currentWip,
    reason: "verified-evidence-does-not-justify-concurrency-change",
    mutationAllowed: false,
  });
}
