import type { PaperCalibrationLearningDecision } from "./evolvePaperCalibrationDecision";
import { isPromotionEligible, type EvolutionValidationResult } from "./evolveValidation";

export interface EvolutionPromotionDecision {
  readonly eligible: boolean;
  readonly exactHeadSha: string;
  readonly reason: string;
}

export function decideEvolutionPromotion(
  validation: EvolutionValidationResult,
  targetBranch: string,
): EvolutionPromotionDecision {
  const normalizedTargetBranch = targetBranch.trim();
  if (!normalizedTargetBranch) throw new Error("EVOLVE_PROMOTION_TARGET_REQUIRED");
  const eligible = isPromotionEligible(validation);
  return Object.freeze({
    eligible,
    exactHeadSha: validation.exactHeadSha,
    reason: eligible
      ? `validated:${normalizedTargetBranch}`
      : `blocked:${validation.status.toLowerCase()}`,
  });
}

/**
 * Evidence-driven promotion gate for PAPER-calibrated evolution opportunities.
 *
 * Validation PASS is necessary but not sufficient: the independently verified PAPER
 * calibration projection must also explicitly allow a confidence increase. UNKNOWN,
 * INSUFFICIENT, NEUTRAL, and regression evidence therefore fail closed without changing
 * the generic evolution promotion path used by non-market opportunities.
 */
export function decidePaperCalibratedEvolutionPromotion(
  validation: EvolutionValidationResult,
  targetBranch: string,
  calibration: PaperCalibrationLearningDecision,
): EvolutionPromotionDecision {
  const baseDecision = decideEvolutionPromotion(validation, targetBranch);
  if (!baseDecision.eligible) return baseDecision;

  const calibrationVerified =
    calibration.comparisonStatus === "VERIFIED_IMPROVEMENT" &&
    calibration.action === "CONFIDENCE_INCREASE_ELIGIBLE" &&
    calibration.calibrationEligible &&
    calibration.confidenceIncreaseEligible;

  if (!calibrationVerified) {
    return Object.freeze({
      eligible: false,
      exactHeadSha: baseDecision.exactHeadSha,
      reason: `blocked:paper-calibration:${calibration.comparisonStatus.toLowerCase()}:${calibration.action.toLowerCase()}`,
    });
  }

  return Object.freeze({
    eligible: true,
    exactHeadSha: baseDecision.exactHeadSha,
    reason: `${baseDecision.reason}:paper-calibration-verified`,
  });
}
