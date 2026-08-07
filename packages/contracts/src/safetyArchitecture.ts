export type OperationalSafetyState = "SAFE" | "DEGRADED" | "RESTRICTED" | "HALT";
export type SafetySignalStatus = "PASS" | "FAIL" | "UNKNOWN";
export type RiskDirection = "INCREASE" | "REDUCE" | "NEUTRAL";
export type HardRiskDecision = "ALLOW" | "BLOCK" | "HALT";
export type LearnedRiskRecommendation = "ALLOW" | "TIGHTEN" | "BLOCK";
export type SafetyAuthorizationDecision = "ALLOW" | "BLOCK" | "HALT";

export interface SafetyEvidenceRef {
  readonly id: string;
  readonly producer: string;
  readonly subjectSha256: string;
  readonly observedAt: string;
  readonly status: SafetySignalStatus;
  readonly safetyCritical: boolean;
}

export interface SafetyActionRequest {
  readonly id: string;
  readonly riskDirection: RiskDirection;
  readonly operationalState: OperationalSafetyState;
  readonly hardRiskDecision: HardRiskDecision;
  readonly learnedRiskRecommendation: LearnedRiskRecommendation;
  readonly evidence: readonly SafetyEvidenceRef[];
  readonly recovery?: {
    readonly requestedState: OperationalSafetyState;
    readonly humanAuthorized: boolean;
    readonly authorizationEvidenceId?: string;
  };
}

export interface SafetyAuthorizationResult {
  readonly decision: SafetyAuthorizationDecision;
  readonly reasonCodes: readonly string[];
  readonly hardRiskAuthorityFinal: true;
  readonly learnedRiskMayRelaxHardLimit: false;
  readonly liveTradingMutationAllowed: false;
  readonly productionPromotionMutationAllowed: false;
}

export const OPERATIONAL_SAFETY_SEVERITY: Readonly<Record<OperationalSafetyState, number>> = Object.freeze({
  SAFE: 0,
  DEGRADED: 1,
  RESTRICTED: 2,
  HALT: 3,
});

export function isStateImprovement(from: OperationalSafetyState, to: OperationalSafetyState): boolean {
  return OPERATIONAL_SAFETY_SEVERITY[to] < OPERATIONAL_SAFETY_SEVERITY[from];
}

/**
 * Constitutional safety composition rule. The learned layer may only preserve or tighten
 * the deterministic hard-risk result. This function never grants LIVE or promotion authority.
 */
export function evaluateSafetyAuthorization(request: SafetyActionRequest): SafetyAuthorizationResult {
  const reasons: string[] = [];
  const critical = request.evidence.filter((item) => item.safetyCritical);
  const hasCriticalUnknown = critical.some((item) => item.status === "UNKNOWN");
  const hasCriticalFailure = critical.some((item) => item.status === "FAIL");

  if (request.hardRiskDecision === "HALT" || request.operationalState === "HALT" || hasCriticalFailure) {
    reasons.push("HARD_SAFETY_HALT");
    if (request.riskDirection === "REDUCE" && request.hardRiskDecision !== "HALT" && !hasCriticalFailure) {
      return fixed("ALLOW", ["HALT_RISK_REDUCTION_ONLY"]);
    }
    return fixed("HALT", reasons);
  }

  if (request.hardRiskDecision === "BLOCK") reasons.push("HARD_RISK_BLOCK");
  if (hasCriticalUnknown && request.riskDirection === "INCREASE") reasons.push("SAFETY_CRITICAL_UNKNOWN");
  if (request.operationalState === "RESTRICTED" && request.riskDirection === "INCREASE") reasons.push("RESTRICTED_NEW_RISK_BLOCKED");
  if (request.learnedRiskRecommendation === "BLOCK") reasons.push("LEARNED_RISK_TIGHTENED_TO_BLOCK");

  if (request.recovery && isStateImprovement(request.operationalState, request.recovery.requestedState)) {
    if (!request.recovery.humanAuthorized || !request.recovery.authorizationEvidenceId) {
      reasons.push("HUMAN_RECOVERY_EVIDENCE_REQUIRED");
    }
  }

  if (reasons.length > 0) return fixed("BLOCK", reasons);
  return fixed("ALLOW", request.learnedRiskRecommendation === "TIGHTEN" ? ["LEARNED_RISK_TIGHTENED"] : []);
}

function fixed(decision: SafetyAuthorizationDecision, reasonCodes: readonly string[]): SafetyAuthorizationResult {
  return Object.freeze({
    decision,
    reasonCodes: Object.freeze([...reasonCodes]),
    hardRiskAuthorityFinal: true as const,
    learnedRiskMayRelaxHardLimit: false as const,
    liveTradingMutationAllowed: false as const,
    productionPromotionMutationAllowed: false as const,
  });
}
