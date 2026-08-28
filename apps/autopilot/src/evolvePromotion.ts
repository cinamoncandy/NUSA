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
