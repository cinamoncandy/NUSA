export type NusaEngineeringOutcomeClassification =
  | "VERIFIED_IMPROVEMENT"
  | "NEUTRAL"
  | "REGRESSION"
  | "INSUFFICIENT";

export interface NusaEngineeringOutcomeEvidence {
  readonly metricId: string;
  readonly direction: "LOWER_IS_BETTER" | "HIGHER_IS_BETTER";
  readonly baseline: number | null;
  readonly postMerge: number | null;
  readonly minimumMeaningfulChange: number;
}

export interface NusaEngineeringOutcomeAssessment {
  readonly schemaVersion: 1;
  readonly classification: NusaEngineeringOutcomeClassification;
  readonly metricId: string;
  readonly baseline: number | null;
  readonly postMerge: number | null;
  readonly delta: number | null;
  readonly recommendation: "KEEP" | "OBSERVE" | "ROLLBACK_OR_REWORK";
  readonly reasons: readonly string[];
}

const finiteOrNull = (value: number | null): boolean => value === null || Number.isFinite(value);

export function assessNusaEngineeringOutcome(evidence: NusaEngineeringOutcomeEvidence): NusaEngineeringOutcomeAssessment {
  if (!evidence.metricId.trim()) throw new Error("OUTCOME_METRIC_ID_REQUIRED");
  if (!finiteOrNull(evidence.baseline) || !finiteOrNull(evidence.postMerge)) throw new Error("OUTCOME_METRIC_NONFINITE");
  if (!Number.isFinite(evidence.minimumMeaningfulChange) || evidence.minimumMeaningfulChange < 0) throw new Error("OUTCOME_THRESHOLD_INVALID");

  if (evidence.baseline === null || evidence.postMerge === null) {
    return Object.freeze({
      schemaVersion: 1 as const,
      classification: "INSUFFICIENT" as const,
      metricId: evidence.metricId,
      baseline: evidence.baseline,
      postMerge: evidence.postMerge,
      delta: null,
      recommendation: "OBSERVE" as const,
      reasons: Object.freeze(["BASELINE_OR_POST_MERGE_EVIDENCE_MISSING"]),
    });
  }

  const delta = evidence.postMerge - evidence.baseline;
  const directionalDelta = evidence.direction === "HIGHER_IS_BETTER" ? delta : -delta;
  let classification: NusaEngineeringOutcomeClassification;
  let recommendation: NusaEngineeringOutcomeAssessment["recommendation"];
  let reason: string;

  if (directionalDelta >= evidence.minimumMeaningfulChange && directionalDelta > 0) {
    classification = "VERIFIED_IMPROVEMENT";
    recommendation = "KEEP";
    reason = "MEASURABLE_IMPROVEMENT_EXCEEDS_THRESHOLD";
  } else if (directionalDelta <= -evidence.minimumMeaningfulChange && directionalDelta < 0) {
    classification = "REGRESSION";
    recommendation = "ROLLBACK_OR_REWORK";
    reason = "MEASURABLE_REGRESSION_EXCEEDS_THRESHOLD";
  } else {
    classification = "NEUTRAL";
    recommendation = "OBSERVE";
    reason = "CHANGE_BELOW_MEANINGFUL_THRESHOLD";
  }

  return Object.freeze({
    schemaVersion: 1 as const,
    classification,
    metricId: evidence.metricId,
    baseline: evidence.baseline,
    postMerge: evidence.postMerge,
    delta,
    recommendation,
    reasons: Object.freeze([reason]),
  });
}
