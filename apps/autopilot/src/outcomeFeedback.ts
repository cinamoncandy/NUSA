export type OutcomeConfidence = "VERIFIED" | "INSUFFICIENT" | "UNKNOWN";
export type OutcomeClassification =
  | "VERIFIED_IMPROVEMENT"
  | "NEUTRAL"
  | "REGRESSION"
  | "INSUFFICIENT";
export type MetricDirection = "MAXIMIZE" | "MINIMIZE";

export interface OutcomeEvidence {
  readonly key: string;
  readonly metric: string;
  readonly direction: MetricDirection;
  readonly confidence: OutcomeConfidence;
  readonly baseline: number | null;
  readonly observed: number | null;
  readonly neutralTolerance: number;
  readonly source: string;
}

export interface OutcomeAssessment {
  readonly key: string;
  readonly metric: string;
  readonly classification: OutcomeClassification;
  readonly baseline: number | null;
  readonly observed: number | null;
  readonly delta: number | null;
  readonly reason: string;
  readonly recommendation: "KEEP" | "REWORK_OR_ROLLBACK" | "GATHER_MORE_EVIDENCE";
  readonly mutationAllowed: false;
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const finite = (value: number | null): value is number => value !== null && Number.isFinite(value);

export function assessOutcome(evidence: OutcomeEvidence): OutcomeAssessment {
  if (
    evidence.confidence !== "VERIFIED" ||
    !finite(evidence.baseline) ||
    !finite(evidence.observed) ||
    !Number.isFinite(evidence.neutralTolerance) ||
    evidence.neutralTolerance < 0
  ) {
    return freeze({
      key: evidence.key,
      metric: evidence.metric,
      classification: "INSUFFICIENT",
      baseline: evidence.baseline,
      observed: evidence.observed,
      delta: null,
      reason: "insufficient-evidence-for-outcome-verification",
      recommendation: "GATHER_MORE_EVIDENCE",
      mutationAllowed: false,
    });
  }

  const rawDelta = evidence.observed - evidence.baseline;
  const signedImprovement = evidence.direction === "MAXIMIZE" ? rawDelta : -rawDelta;

  if (Math.abs(signedImprovement) <= evidence.neutralTolerance) {
    return freeze({
      key: evidence.key,
      metric: evidence.metric,
      classification: "NEUTRAL",
      baseline: evidence.baseline,
      observed: evidence.observed,
      delta: rawDelta,
      reason: "verified-change-within-neutral-tolerance",
      recommendation: "KEEP",
      mutationAllowed: false,
    });
  }

  if (signedImprovement > 0) {
    return freeze({
      key: evidence.key,
      metric: evidence.metric,
      classification: "VERIFIED_IMPROVEMENT",
      baseline: evidence.baseline,
      observed: evidence.observed,
      delta: rawDelta,
      reason: "verified-post-change-improvement",
      recommendation: "KEEP",
      mutationAllowed: false,
    });
  }

  return freeze({
    key: evidence.key,
    metric: evidence.metric,
    classification: "REGRESSION",
    baseline: evidence.baseline,
    observed: evidence.observed,
    delta: rawDelta,
    reason: "verified-post-change-regression",
    recommendation: "REWORK_OR_ROLLBACK",
    mutationAllowed: false,
  });
}
