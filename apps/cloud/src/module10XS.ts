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

export interface TenXSOperationalEvidence {
  readonly sourceCommitSha: string;
  readonly evidenceFingerprint: string;
  readonly deterministicReplayPassed: boolean;
  readonly shadowComparisonPassed: boolean;
  readonly recoveryDrillPassed: boolean;
  readonly regressionBudgetPassed: boolean;
}

export interface TenXSCertificationEvidence {
  readonly stage: ModuleStage;
  readonly level10Satisfied: boolean;
  readonly capabilities: Readonly<Record<TenXSCapability, boolean>>;
  readonly evidenceRefs: readonly string[];
  readonly safetyBoundaryIntact: boolean;
  readonly regressionFree: boolean;
  readonly lastKnownGoodRef: string;
  readonly operational: TenXSOperationalEvidence;
}

export interface TenXSCertificationResult {
  readonly stage: ModuleStage;
  readonly targetTier: "10X-S";
  readonly effectiveTier: ModuleTier;
  readonly status: "CERTIFIED" | "DEMOTED" | "QUARANTINED";
  readonly reasons: readonly string[];
  readonly lastKnownGoodRef: string;
  readonly evidenceFingerprint: string;
}

const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;

export function evaluateTenXSCertification(evidence: TenXSCertificationEvidence): TenXSCertificationResult {
  const reasons: string[] = [];
  if (!evidence.level10Satisfied) reasons.push("LEVEL10_BASELINE_FAILED");
  if (!evidence.safetyBoundaryIntact) reasons.push("SAFETY_BOUNDARY_FAILED");
  if (!evidence.regressionFree) reasons.push("REGRESSION_DETECTED");
  if (!SHA40.test(evidence.lastKnownGoodRef)) reasons.push("LAST_KNOWN_GOOD_INVALID");
  if (evidence.evidenceRefs.length < 3 || evidence.evidenceRefs.some((ref) => !ref.trim())) reasons.push("INSUFFICIENT_EVIDENCE");

  if (!SHA40.test(evidence.operational.sourceCommitSha)) reasons.push("SOURCE_COMMIT_INVALID");
  if (!SHA64.test(evidence.operational.evidenceFingerprint)) reasons.push("EVIDENCE_FINGERPRINT_INVALID");
  if (!evidence.operational.deterministicReplayPassed) reasons.push("DETERMINISTIC_REPLAY_FAILED");
  if (!evidence.operational.shadowComparisonPassed) reasons.push("SHADOW_COMPARISON_FAILED");
  if (!evidence.operational.recoveryDrillPassed) reasons.push("RECOVERY_DRILL_FAILED");
  if (!evidence.operational.regressionBudgetPassed) reasons.push("REGRESSION_BUDGET_FAILED");

  for (const capability of TEN_X_S_CAPABILITIES) {
    if (evidence.capabilities[capability] !== true) reasons.push(`CAPABILITY_MISSING:${capability}`);
  }

  const safetyCriticalFailure = reasons.some((reason) =>
    reason === "SAFETY_BOUNDARY_FAILED" ||
    reason === "LAST_KNOWN_GOOD_INVALID" ||
    reason === "LEVEL10_BASELINE_FAILED" ||
    reason === "SOURCE_COMMIT_INVALID" ||
    reason === "EVIDENCE_FINGERPRINT_INVALID"
  );

  if (safetyCriticalFailure) {
    return Object.freeze({
      stage: evidence.stage,
      targetTier: "10X-S",
      effectiveTier: "LEVEL_10",
      status: "QUARANTINED",
      reasons: Object.freeze(reasons.sort()),
      lastKnownGoodRef: evidence.lastKnownGoodRef,
      evidenceFingerprint: evidence.operational.evidenceFingerprint
    });
  }

  if (reasons.length === 0) {
    return Object.freeze({
      stage: evidence.stage,
      targetTier: "10X-S",
      effectiveTier: "10X-S",
      status: "CERTIFIED",
      reasons: Object.freeze([]),
      lastKnownGoodRef: evidence.lastKnownGoodRef,
      evidenceFingerprint: evidence.operational.evidenceFingerprint
    });
  }

  const tenXReady = evidence.capabilities.SELF_DIAGNOSTIC &&
    evidence.capabilities.ROLLBACK_READY &&
    evidence.capabilities.EVIDENCE_PROMOTION &&
    evidence.operational.recoveryDrillPassed;

  return Object.freeze({
    stage: evidence.stage,
    targetTier: "10X-S",
    effectiveTier: tenXReady ? "10X" : "LEVEL_10",
    status: "DEMOTED",
    reasons: Object.freeze(reasons.sort()),
    lastKnownGoodRef: evidence.lastKnownGoodRef,
    evidenceFingerprint: evidence.operational.evidenceFingerprint
  });
}
