import type { PaperCalibrationComparison } from "./evolvePaperCalibrationEvidence";

export type PaperCalibrationLearningAction =
  | "CONFIDENCE_INCREASE_ELIGIBLE"
  | "HOLD"
  | "DEMOTE";

export interface PaperCalibrationLearningDecision {
  readonly comparisonStatus: PaperCalibrationComparison["status"];
  readonly action: PaperCalibrationLearningAction;
  readonly calibrationEligible: boolean;
  readonly confidenceIncreaseEligible: boolean;
  readonly reasons: readonly string[];
  readonly authority: {
    readonly liveAuthority: "NONE";
    readonly productionMutationAllowed: false;
    readonly aiAuthority: "ZERO_AUTHORITY";
  };
}

/**
 * Deterministic read-only projection from verified PAPER calibration comparison into the
 * existing evolution loop. This does not mutate confidence or strategy standing itself.
 * It closes the fail-closed policy gap by making calibration regression explicitly remove
 * calibration eligibility, while insufficient/neutral evidence can only HOLD.
 */
export function projectPaperCalibrationLearningDecision(
  comparison: PaperCalibrationComparison,
): PaperCalibrationLearningDecision {
  let action: PaperCalibrationLearningAction = "HOLD";
  let calibrationEligible = false;

  if (comparison.status === "REGRESSION") {
    action = "DEMOTE";
  } else if (
    comparison.status === "VERIFIED_IMPROVEMENT" &&
    comparison.confidenceIncreaseEligible &&
    comparison.decision.increased
  ) {
    action = "CONFIDENCE_INCREASE_ELIGIBLE";
    calibrationEligible = true;
  }

  const reasons = [
    "PAPER_CALIBRATION_LEARNING_DECISION",
    "READ_ONLY_PROJECTION",
    "NO_EXECUTION_AUTHORITY",
    action === "DEMOTE"
      ? "CALIBRATION_REGRESSION_REQUIRES_ELIGIBILITY_REDUCTION"
      : action === "CONFIDENCE_INCREASE_ELIGIBLE"
        ? "INDEPENDENT_VERIFIED_CALIBRATION_IMPROVEMENT"
        : "CALIBRATION_EVIDENCE_DOES_NOT_SUPPORT_INCREASE",
  ];

  return Object.freeze({
    comparisonStatus: comparison.status,
    action,
    calibrationEligible,
    confidenceIncreaseEligible: action === "CONFIDENCE_INCREASE_ELIGIBLE",
    reasons: Object.freeze(reasons.sort()),
    authority: Object.freeze({
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    }),
  });
}
