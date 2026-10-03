import { createHash } from "node:crypto";
import type { CapitalAllocationPolicy } from "./capitalAllocationEngine";
import { evaluatePaperPortfolioRiskEvidence, type PaperPortfolioRiskEvidenceInput } from "./paperPortfolioRiskEvidence";
import {
  fingerprintFamilyPortfolioRiskPolicy,
  verifyFamilyPortfolioRiskEvidenceFingerprint,
  type FamilyPortfolioRiskEvidence,
  type FamilyPortfolioRiskPolicy,
} from "./familyPortfolioRiskEvidence";

export type PaperPortfolioAdvisoryDecision = "ADVISE" | "ABSTAIN";
export type PaperEvidenceStatus = "VERIFIED" | "INSUFFICIENT" | "UNKNOWN" | "CONFLICTING";

export interface PaperPortfolioEvidence {
  readonly candidateId: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly observedAt: string;
  readonly regime: string;
  readonly status: PaperEvidenceStatus;
  readonly evidencePeriods: number;
  readonly currentPortfolioGrossWeight: number;
  readonly currentStrategyWeight: number;
  readonly maximumPeerCorrelation: number;
  readonly regimeCoFailureRate: number;
  readonly estimatedTurnover: number;
  readonly estimatedFeeRate: number;
  readonly estimatedSlippageRate: number;
  readonly grossExpectedEdge: number;
}

export interface PaperFamilyRiskAdvisoryBinding {
  readonly strategyId: string;
  readonly familyId: string;
  readonly observedAt: string;
  readonly sourceSha: string;
  readonly evidence: FamilyPortfolioRiskEvidence;
  readonly bindingFingerprintSha256: string;
}

export interface PaperPortfolioAdvisoryInput {
  readonly advisoryId: string;
  readonly strategyId: string;
  readonly generatedAt: string;
  readonly source: "PAPER" | "SHADOW";
  readonly evidence: PaperPortfolioEvidence;
  readonly minimumEvidencePeriods: number;
  readonly maximumEvidenceAgeMs: number;
  readonly maximumRegimeCoFailureRate: number;
  readonly familyRiskPolicy: FamilyPortfolioRiskPolicy;
  readonly riskEvidence?: PaperPortfolioRiskEvidenceInput;
  readonly familyRisk?: PaperFamilyRiskAdvisoryBinding;
}

export interface PaperPortfolioAdvisoryResult {
  readonly advisoryId: string;
  readonly strategyId: string;
  readonly familyId: string | null;
  readonly familyRiskFingerprintSha256: string | null;
  readonly familyRiskBindingFingerprintSha256: string | null;
  readonly familyRiskPolicyFingerprintSha256: string | null;
  readonly decision: PaperPortfolioAdvisoryDecision;
  readonly recommendedWeight: number;
  readonly maximumWeight: number;
  readonly netExpectedEdge: number;
  readonly reasons: readonly string[];
  readonly candidateId: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly regime: string;
  readonly evidenceObservedAt: string;
  readonly generatedAt: string;
  readonly source: "PAPER" | "SHADOW";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

const sha256 = /^[a-f0-9]{64}$/i;
const gitSha = /^[a-f0-9]{40}$/i;
const familyRiskBindingFingerprint = (input: Omit<PaperFamilyRiskAdvisoryBinding, "bindingFingerprintSha256">): string =>
  createHash("sha256").update([
    `strategyId=${input.strategyId}`,
    `familyId=${input.familyId}`,
    `observedAt=${input.observedAt}`,
    `sourceSha=${input.sourceSha.toLowerCase()}`,
    `evidenceFingerprintSha256=${input.evidence.fingerprintSha256.toLowerCase()}`,
  ].join("\n"), "utf8").digest("hex");

export const createPaperFamilyRiskAdvisoryBinding = (
  input: Omit<PaperFamilyRiskAdvisoryBinding, "bindingFingerprintSha256">,
): PaperFamilyRiskAdvisoryBinding => Object.freeze({
  ...input,
  bindingFingerprintSha256: familyRiskBindingFingerprint(input),
});

const requireFinite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
};
const requireRatio = (value: number, label: string): void => {
  requireFinite(value, label);
  if (value < 0 || value > 1) throw new Error(`${label} must be between 0 and 1`);
};
const roundFinite = (value: number, label: string): number => {
  requireFinite(value, label);
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  requireFinite(rounded, label);
  return rounded;
};
const validateConsumedPolicy = (policy: CapitalAllocationPolicy): void => {
  requireRatio(policy.maximumPortfolioWeight, "maximumPortfolioWeight");
  requireRatio(policy.maximumStrategyWeight, "maximumStrategyWeight");
  requireRatio(policy.maximumCorrelation, "maximumCorrelation");
};
const validateFamilyRiskPolicy = (policy: FamilyPortfolioRiskPolicy): void => {
  requireRatio(policy.maximumStrategyWeight, "familyRiskPolicy.maximumStrategyWeight");
  requireRatio(policy.maximumFamilyWeight, "familyRiskPolicy.maximumFamilyWeight");
  requireRatio(policy.maximumAbsoluteFamilyCorrelation, "familyRiskPolicy.maximumAbsoluteFamilyCorrelation");
  requireRatio(policy.maximumFamilyDrawdownOverlap, "familyRiskPolicy.maximumFamilyDrawdownOverlap");
  requireRatio(policy.maximumRegimeConcentration, "familyRiskPolicy.maximumRegimeConcentration");
  requireRatio(policy.maximumFamilyRiskBudgetUsage, "familyRiskPolicy.maximumFamilyRiskBudgetUsage");
};
const freezeResult = (result: PaperPortfolioAdvisoryResult): PaperPortfolioAdvisoryResult => {
  Object.freeze(result.reasons);
  return Object.freeze(result);
};

export const evaluatePaperPortfolioAdvisory = (
  input: PaperPortfolioAdvisoryInput,
  policy: CapitalAllocationPolicy
): PaperPortfolioAdvisoryResult => {
  if (!input.advisoryId.trim()) throw new Error("advisoryId is required");
  if (!input.strategyId.trim()) throw new Error("strategyId is required");
  if (!input.evidence.candidateId.trim()) throw new Error("candidateId is required");
  if (!input.evidence.datasetId.trim()) throw new Error("datasetId is required");
  if (!sha256.test(input.evidence.datasetContentSha256)) throw new Error("datasetContentSha256 must be sha256");
  if (!input.evidence.regime.trim()) throw new Error("regime is required");

  const generatedAtMs = Date.parse(input.generatedAt);
  const observedAtMs = Date.parse(input.evidence.observedAt);
  if (!Number.isFinite(generatedAtMs)) throw new Error("generatedAt must be a valid ISO timestamp");
  if (!Number.isFinite(observedAtMs)) throw new Error("observedAt must be a valid ISO timestamp");
  if (!Number.isInteger(input.minimumEvidencePeriods) || input.minimumEvidencePeriods <= 0) throw new Error("minimumEvidencePeriods must be a positive integer");
  if (!Number.isInteger(input.evidence.evidencePeriods) || input.evidence.evidencePeriods < 0) throw new Error("evidencePeriods must be a non-negative integer");
  if (!Number.isFinite(input.maximumEvidenceAgeMs) || input.maximumEvidenceAgeMs < 0) throw new Error("maximumEvidenceAgeMs must be non-negative");
  validateConsumedPolicy(policy);
  validateFamilyRiskPolicy(input.familyRiskPolicy);
  const expectedFamilyRiskPolicyFingerprintSha256 = fingerprintFamilyPortfolioRiskPolicy(input.familyRiskPolicy);
  requireRatio(input.maximumRegimeCoFailureRate, "maximumRegimeCoFailureRate");
  requireRatio(input.evidence.currentPortfolioGrossWeight, "currentPortfolioGrossWeight");
  requireRatio(input.evidence.currentStrategyWeight, "currentStrategyWeight");
  requireRatio(input.evidence.maximumPeerCorrelation, "maximumPeerCorrelation");
  requireRatio(input.evidence.regimeCoFailureRate, "regimeCoFailureRate");
  requireRatio(input.evidence.estimatedTurnover, "estimatedTurnover");
  requireRatio(input.evidence.estimatedFeeRate, "estimatedFeeRate");
  requireRatio(input.evidence.estimatedSlippageRate, "estimatedSlippageRate");
  requireFinite(input.evidence.grossExpectedEdge, "grossExpectedEdge");

  const reasons: string[] = [];
  const familyRisk = input.familyRisk;
  if (familyRisk == null) {
    reasons.push("FAMILY_RISK_EVIDENCE_MISSING");
  } else {
    const familyObservedAtMs = Date.parse(familyRisk.observedAt);
    if (!familyRisk.strategyId.trim() || !familyRisk.familyId.trim()) reasons.push("FAMILY_RISK_IDENTITY_MISSING");
    if (!gitSha.test(familyRisk.sourceSha)) reasons.push("FAMILY_RISK_SOURCE_SHA_INVALID");
    const expectedBindingFingerprint = familyRiskBindingFingerprint({
      strategyId: familyRisk.strategyId,
      familyId: familyRisk.familyId,
      observedAt: familyRisk.observedAt,
      sourceSha: familyRisk.sourceSha,
      evidence: familyRisk.evidence,
    });
    if (!sha256.test(familyRisk.bindingFingerprintSha256)
      || familyRisk.bindingFingerprintSha256 !== expectedBindingFingerprint) reasons.push("FAMILY_RISK_BINDING_FINGERPRINT_MISMATCH");
    if (!verifyFamilyPortfolioRiskEvidenceFingerprint(familyRisk.evidence)) reasons.push("FAMILY_RISK_FINGERPRINT_MISMATCH");
    if (familyRisk.evidence.policyFingerprintSha256 !== expectedFamilyRiskPolicyFingerprintSha256) reasons.push("FAMILY_RISK_POLICY_MISMATCH");
    if (!Number.isFinite(familyObservedAtMs)) reasons.push("FAMILY_RISK_TIMESTAMP_INVALID");
    else {
      if (familyObservedAtMs > generatedAtMs) reasons.push("FAMILY_RISK_EVIDENCE_FUTURE");
      if (generatedAtMs - familyObservedAtMs > input.maximumEvidenceAgeMs) reasons.push("FAMILY_RISK_EVIDENCE_STALE");
    }
    if (familyRisk.strategyId !== input.strategyId) reasons.push("FAMILY_RISK_STRATEGY_MISMATCH");
    if (familyRisk.evidence.status !== "VERIFIED") reasons.push("FAMILY_RISK_NOT_VERIFIED");
    if (familyRisk.evidence.mode !== "PAPER_ONLY"
      || familyRisk.evidence.liveAuthority !== "NONE"
      || familyRisk.evidence.productionMutationAllowed !== false
      || familyRisk.evidence.aiAuthority !== "ZERO_AUTHORITY") reasons.push("FAMILY_RISK_AUTHORITY_MISMATCH");
    if (!(familyRisk.strategyId in familyRisk.evidence.strategyExposure)) reasons.push("FAMILY_RISK_STRATEGY_NOT_COVERED");
    if (!(familyRisk.familyId in familyRisk.evidence.familyExposure)) reasons.push("FAMILY_RISK_FAMILY_NOT_COVERED");
    if (familyRisk.evidence.strategyFamily[familyRisk.strategyId] !== familyRisk.familyId) reasons.push("FAMILY_RISK_STRATEGY_FAMILY_MISMATCH");
    if ((familyRisk.evidence.reasons?.length ?? 0) > 0) reasons.push(...familyRisk.evidence.reasons.map((reason) => `FAMILY_RISK_${reason}`));
  }

  if (input.riskEvidence == null) {
    reasons.push("RISK_EVIDENCE_MISSING");
  } else {
    const risk = evaluatePaperPortfolioRiskEvidence(input.riskEvidence);
    const riskEvaluatedAtMs = Date.parse(risk.evaluatedAt);
    if (risk.candidateId !== input.evidence.candidateId
      || risk.datasetId !== input.evidence.datasetId
      || risk.datasetContentSha256 !== input.evidence.datasetContentSha256) {
      reasons.push("RISK_EVIDENCE_PROVENANCE_MISMATCH");
    }
    if (risk.portfolioRegime !== input.evidence.regime) reasons.push("RISK_REGIME_MISMATCH");
    if (risk.maximumAbsoluteCandidateCorrelation !== input.evidence.maximumPeerCorrelation) reasons.push("RISK_CANDIDATE_DEPENDENCE_MISMATCH");
    if (risk.regimeCoFailureRate !== input.evidence.regimeCoFailureRate) reasons.push("RISK_REGIME_CO_FAILURE_MISMATCH");
    if (risk.currentPortfolioGrossWeight !== input.evidence.currentPortfolioGrossWeight
      || risk.currentStrategyWeight !== input.evidence.currentStrategyWeight) reasons.push("RISK_CONCENTRATION_EVIDENCE_MISMATCH");
    if (risk.estimatedTurnover !== input.evidence.estimatedTurnover
      || risk.estimatedFeeRate !== input.evidence.estimatedFeeRate
      || risk.estimatedSlippageRate !== input.evidence.estimatedSlippageRate
      || risk.grossExpectedEdge !== input.evidence.grossExpectedEdge) reasons.push("RISK_COST_EDGE_EVIDENCE_MISMATCH");
    if (riskEvaluatedAtMs > generatedAtMs) reasons.push("RISK_EVIDENCE_FUTURE");
    if (generatedAtMs - riskEvaluatedAtMs > input.maximumEvidenceAgeMs) reasons.push("RISK_EVALUATION_STALE");
    if (risk.decision !== "ACCEPT") reasons.push(...risk.reasons.map((reason) => `RISK_${reason}`));
  }

  if (input.evidence.status !== "VERIFIED") reasons.push(`EVIDENCE_${input.evidence.status}`);
  if (input.evidence.evidencePeriods < input.minimumEvidencePeriods) reasons.push("INSUFFICIENT_LONGITUDINAL_EVIDENCE");
  if (observedAtMs > generatedAtMs) reasons.push("FUTURE_EVIDENCE");
  if (generatedAtMs - observedAtMs > input.maximumEvidenceAgeMs) reasons.push("STALE_EVIDENCE");
  if (input.evidence.maximumPeerCorrelation > policy.maximumCorrelation) reasons.push("CORRELATION_LIMIT_EXCEEDED");
  if (input.evidence.regimeCoFailureRate > input.maximumRegimeCoFailureRate) reasons.push("REGIME_CO_FAILURE_LIMIT_EXCEEDED");

  const costDrag = input.evidence.estimatedTurnover * (input.evidence.estimatedFeeRate + input.evidence.estimatedSlippageRate);
  const netExpectedEdge = roundFinite(input.evidence.grossExpectedEdge - costDrag, "netExpectedEdge");
  if (netExpectedEdge <= 0) reasons.push("NON_POSITIVE_EDGE_AFTER_COSTS");

  const availablePortfolioWeight = Math.max(
    0,
    policy.maximumPortfolioWeight - input.evidence.currentPortfolioGrossWeight + input.evidence.currentStrategyWeight
  );
  const maximumWeight = roundFinite(Math.min(policy.maximumStrategyWeight, availablePortfolioWeight), "maximumWeight");
  if (maximumWeight <= 0) reasons.push("PORTFOLIO_CONCENTRATION_LIMIT_REACHED");
  if (familyRisk != null) {
    const evaluatedStrategyWeight = familyRisk.evidence.strategyExposure[familyRisk.strategyId];
    if (evaluatedStrategyWeight != null && evaluatedStrategyWeight !== maximumWeight) reasons.push("FAMILY_RISK_PROPOSED_WEIGHT_MISMATCH");
  }

  const failClosed = reasons.length > 0;
  const recommendedWeight = failClosed ? 0 : maximumWeight;
  requireFinite(recommendedWeight, "recommendedWeight");

  return freezeResult({
    advisoryId: input.advisoryId,
    strategyId: input.strategyId,
    familyId: familyRisk?.familyId ?? null,
    familyRiskFingerprintSha256: familyRisk?.evidence.fingerprintSha256 ?? null,
    familyRiskBindingFingerprintSha256: familyRisk?.bindingFingerprintSha256 ?? null,
    familyRiskPolicyFingerprintSha256: familyRisk?.evidence.policyFingerprintSha256 ?? null,
    decision: failClosed ? "ABSTAIN" : "ADVISE",
    recommendedWeight,
    maximumWeight,
    netExpectedEdge,
    reasons: Object.freeze(reasons),
    candidateId: input.evidence.candidateId,
    datasetId: input.evidence.datasetId,
    datasetContentSha256: input.evidence.datasetContentSha256,
    regime: input.evidence.regime,
    evidenceObservedAt: input.evidence.observedAt,
    generatedAt: input.generatedAt,
    source: input.source,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY"
  });
};
