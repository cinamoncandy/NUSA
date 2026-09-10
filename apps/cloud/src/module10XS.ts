import type { ModuleStage, ModuleTier } from "./moduleLevel10";

export const TEN_X_S_CAPABILITIES = Object.freeze([
  "SELF_DIAGNOSTIC",
  "SHADOW_COMPARABLE",
  "REGRESSION_GUARDED",
  "AUTO_QUARANTINE",
  "ROLLBACK_READY",
  "EVIDENCE_PROMOTION"
] as const);

export type TenXSCapability = (typeof TEN_X_S_CAPABILITIES)[number];

export interface TenXSCertificationEvidence {
  readonly stage: ModuleStage;
  readonly level10Satisfied: boolean;
  readonly capabilities: Readonly<Record<TenXSCapability, boolean>>;
  readonly evidenceRefs: readonly string[];
  readonly safetyBoundaryIntact: boolean;
  readonly regressionFree: boolean;
  readonly lastKnownGoodRef: string;
}

export interface TenXSCertificationResult {
  readonly stage: ModuleStage;
  readonly targetTier: "10X-S";
  readonly effectiveTier: ModuleTier;
  readonly status: "CERTIFIED" | "DEMOTED" | "QUARANTINED";
  readonly reasons: readonly string[];
  readonly lastKnownGoodRef: string;
}

export function evaluateTenXSCertification(evidence: TenXSCertificationEvidence): TenXSCertificationResult {
  const reasons: string[] = [];
  if (!evidence.level10Satisfied) reasons.push("LEVEL10_BASELINE_FAILED");
  if (!evidence.safetyBoundaryIntact) reasons.push("SAFETY_BOUNDARY_FAILED");
  if (!evidence.regressionFree) reasons.push("REGRESSION_DETECTED");
  if (!evidence.lastKnownGoodRef.trim()) reasons.push("LAST_KNOWN_GOOD_MISSING");
  if (evidence.evidenceRefs.length < 2 || evidence.evidenceRefs.some((ref) => !ref.trim())) reasons.push("INSUFFICIENT_EVIDENCE");

  for (const capability of TEN_X_S_CAPABILITIES) {
    if (evidence.capabilities[capability] !== true) reasons.push(`CAPABILITY_MISSING:${capability}`);
  }

  const safetyCriticalFailure = reasons.some((reason) =>
    reason === "SAFETY_BOUNDARY_FAILED" ||
    reason === "LAST_KNOWN_GOOD_MISSING" ||
    reason === "LEVEL10_BASELINE_FAILED"
  );

  if (safetyCriticalFailure) {
    return Object.freeze({
      stage: evidence.stage,
      targetTier: "10X-S",
      effectiveTier: "LEVEL_10",
      status: "QUARANTINED",
      reasons: Object.freeze(reasons.sort()),
      lastKnownGoodRef: evidence.lastKnownGoodRef
    });
  }

  if (reasons.length === 0) {
    return Object.freeze({
      stage: evidence.stage,
      targetTier: "10X-S",
      effectiveTier: "10X-S",
      status: "CERTIFIED",
      reasons: Object.freeze([]),
      lastKnownGoodRef: evidence.lastKnownGoodRef
    });
  }

  const tenXReady = evidence.capabilities.SELF_DIAGNOSTIC &&
    evidence.capabilities.ROLLBACK_READY &&
    evidence.capabilities.EVIDENCE_PROMOTION;

  return Object.freeze({
    stage: evidence.stage,
    targetTier: "10X-S",
    effectiveTier: tenXReady ? "10X" : "LEVEL_10",
    status: "DEMOTED",
    reasons: Object.freeze(reasons.sort()),
    lastKnownGoodRef: evidence.lastKnownGoodRef
  });
}
