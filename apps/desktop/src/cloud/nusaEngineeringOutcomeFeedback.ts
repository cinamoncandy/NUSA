import type { NusaCiCriticalPathTelemetry } from "./nusaCiCriticalPathTelemetry";

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

export interface NusaEngineeringCiOutcomeEvidence {
  /** Exact-head telemetry derived from immutable completed GitHub job receipts. */
  readonly baseline: NusaCiCriticalPathTelemetry | null;
  /** Exact-head telemetry for the post-change observation. */
  readonly postMerge: NusaCiCriticalPathTelemetry | null;
  readonly minimumMeaningfulChange: number;
}

export interface NusaEngineeringCiOutcomeAssessment extends NusaEngineeringOutcomeAssessment {
  readonly metricId: "ci-workflow-p95-ms";
  readonly baselineHeadSha: string | null;
  readonly postMergeHeadSha: string | null;
  readonly baselineSourceFingerprints: readonly string[];
  readonly postMergeSourceFingerprints: readonly string[];
}

const finiteOrNull = (value: number | null): boolean => value === null || Number.isFinite(value);
const SHA_40 = /^[a-f0-9]{40}$/;
const SHA_64 = /^[a-f0-9]{64}$/;

function validateCiTelemetry(telemetry: NusaCiCriticalPathTelemetry, label: string): readonly string[] {
  if (telemetry.schemaVersion !== 1 || !SHA_40.test(telemetry.headSha)) throw new Error(`OUTCOME_${label.toUpperCase()}_HEAD_INVALID`);
  if (!Number.isSafeInteger(telemetry.jobSampleCount) || telemetry.jobSampleCount < 1) throw new Error(`OUTCOME_${label.toUpperCase()}_SAMPLES_MISSING`);
  if (!Number.isFinite(telemetry.workflowP95Ms) || telemetry.workflowP95Ms < 0) throw new Error(`OUTCOME_${label.toUpperCase()}_P95_INVALID`);
  if (!Array.isArray(telemetry.sourceFingerprints)
    || telemetry.sourceFingerprints.length === 0
    || new Set(telemetry.sourceFingerprints).size !== telemetry.sourceFingerprints.length
    || telemetry.sourceFingerprints.some((fingerprint) => !SHA_64.test(fingerprint))) {
    throw new Error(`OUTCOME_${label.toUpperCase()}_PROVENANCE_INVALID`);
  }
  return Object.freeze([...telemetry.sourceFingerprints].sort());
}

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

/**
 * Evaluates a CI optimization only from two distinct exact-head telemetry summaries. The helper
 * intentionally cannot infer a speedup from a single head, an empty receipt set, or summaries
 * whose source provenance is absent. Callers may pass null while a real post-merge observation is
 * unavailable; that state remains INSUFFICIENT rather than becoming a success claim.
 */
export function assessNusaCiCriticalPathOutcome(
  evidence: NusaEngineeringCiOutcomeEvidence,
): NusaEngineeringCiOutcomeAssessment {
  const baseline = evidence.baseline;
  const postMerge = evidence.postMerge;
  if (!Number.isFinite(evidence.minimumMeaningfulChange) || evidence.minimumMeaningfulChange < 0) {
    throw new Error("OUTCOME_THRESHOLD_INVALID");
  }
  const baselineSourceFingerprints = baseline == null ? Object.freeze([]) : validateCiTelemetry(baseline, "baseline");
  const postMergeSourceFingerprints = postMerge == null ? Object.freeze([]) : validateCiTelemetry(postMerge, "post_merge");
  if (baseline != null && postMerge != null && baseline.headSha === postMerge.headSha) {
    throw new Error("OUTCOME_HEADS_NOT_DISTINCT");
  }
  if (baselineSourceFingerprints.some((fingerprint) => postMergeSourceFingerprints.includes(fingerprint))) {
    throw new Error("OUTCOME_PROVENANCE_NOT_DISTINCT");
  }

  const assessment = assessNusaEngineeringOutcome({
    metricId: "ci-workflow-p95-ms",
    direction: "LOWER_IS_BETTER",
    baseline: baseline?.workflowP95Ms ?? null,
    postMerge: postMerge?.workflowP95Ms ?? null,
    minimumMeaningfulChange: evidence.minimumMeaningfulChange,
  });
  return Object.freeze({
    ...assessment,
    metricId: "ci-workflow-p95-ms" as const,
    baselineHeadSha: baseline?.headSha ?? null,
    postMergeHeadSha: postMerge?.headSha ?? null,
    baselineSourceFingerprints,
    postMergeSourceFingerprints,
  });
}
