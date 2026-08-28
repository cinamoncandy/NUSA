export type OutcomeConfidence = "VERIFIED" | "INSUFFICIENT" | "UNKNOWN";
export type OutcomeClassification =
  | "VERIFIED_IMPROVEMENT"
  | "NEUTRAL"
  | "REGRESSION"
  | "INSUFFICIENT";
export type OutcomeDirection = "HIGHER_IS_BETTER" | "LOWER_IS_BETTER";

export interface OutcomeEvidence {
  readonly key: string;
  readonly source: string;
  readonly confidence: OutcomeConfidence;
  readonly baseline: number | null;
  readonly current: number | null;
  readonly direction: OutcomeDirection;
  readonly minimumMeaningfulDelta: number | null;
}

export interface OutcomeEvaluation {
  readonly key: string;
  readonly source: string;
  readonly classification: OutcomeClassification;
  readonly directionalDelta: number | null;
  readonly recommendation: "KEEP" | "REWORK_OR_ROLLBACK" | "GATHER_EVIDENCE";
  readonly mutationAllowed: false;
  readonly reason: string;
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const finite = (value: number | null): value is number => value !== null && Number.isFinite(value);

export function evaluateOutcome(evidence: OutcomeEvidence): OutcomeEvaluation {
  if (
    evidence.confidence !== "VERIFIED" ||
    !finite(evidence.baseline) ||
    !finite(evidence.current) ||
    !finite(evidence.minimumMeaningfulDelta) ||
    evidence.minimumMeaningfulDelta < 0
  ) {
    return freeze({
      key: evidence.key,
      source: evidence.source,
      classification: "INSUFFICIENT",
      directionalDelta: null,
      recommendation: "GATHER_EVIDENCE",
      mutationAllowed: false,
      reason: "insufficient-evidence-for-outcome-classification",
    });
  }

  const directionalDelta =
    evidence.direction === "HIGHER_IS_BETTER"
      ? evidence.current - evidence.baseline
      : evidence.baseline - evidence.current;

  if (Math.abs(directionalDelta) <= evidence.minimumMeaningfulDelta) {
    return freeze({
      key: evidence.key,
      source: evidence.source,
      classification: "NEUTRAL",
      directionalDelta,
      recommendation: "KEEP",
      mutationAllowed: false,
      reason: "change-within-meaningful-threshold",
    });
  }

  if (directionalDelta > 0) {
    return freeze({
      key: evidence.key,
      source: evidence.source,
      classification: "VERIFIED_IMPROVEMENT",
      directionalDelta,
      recommendation: "KEEP",
      mutationAllowed: false,
      reason: "verified-post-merge-improvement",
    });
  }

  return freeze({
    key: evidence.key,
    source: evidence.source,
    classification: "REGRESSION",
    directionalDelta,
    recommendation: "REWORK_OR_ROLLBACK",
    mutationAllowed: false,
    reason: "verified-post-merge-regression",
  });
}
