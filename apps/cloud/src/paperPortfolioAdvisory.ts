import type { CapitalAllocationPolicy } from "./capitalAllocationEngine";
import { evaluatePaperPortfolioRiskEvidence, type PaperPortfolioRiskEvidenceInput } from "./paperPortfolioRiskEvidence";

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

export interface PaperPortfolioAdvisoryInput {
  readonly advisoryId: string;
  readonly strategyId: string;
  readonly generatedAt: string;
  readonly source: "PAPER" | "SHADOW";
  readonly evidence: PaperPortfolioEvidence;
  readonly minimumEvidencePeriods: number;
  readonly maximumEvidenceAgeMs: number;
  readonly maximumRegimeCoFailureRate: number;
  /** Canonical portfolio risk evidence is required for an allocation advisory. */
  readonly riskEvidence?: PaperPortfolioRiskEvidenceInput;
}

export interface PaperPortfolioAdvisoryResult {
  readonly advisoryId: string;
  readonly strategyId: string;
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
  if (!Number.isInteger(input.minimumEvidencePeriods) || input.minimumEvidencePeriods <= 0) {
    throw new Error("minimumEvidencePeriods must be a positive integer");
  }
  if (!Number.isInteger(input.evidence.evidencePeriods) || input.evidence.evidencePeriods < 0) {
    throw new Error("evidencePeriods must be a non-negative integer");
  }
  if (!Number.isFinite(input.maximumEvidenceAgeMs) || input.maximumEvidenceAgeMs < 0) {
    throw new Error("maximumEvidenceAgeMs must be non-negative");
  }
  validateConsumedPolicy(policy);
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
    if (risk.maximumAbsoluteCandidateCorrelation !== input.evidence.maximumPeerCorrelation) {
      reasons.push("RISK_CANDIDATE_DEPENDENCE_MISMATCH");
    }
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

  const costDrag = input.evidence.estimatedTurnover
    * (input.evidence.estimatedFeeRate + input.evidence.estimatedSlippageRate);
  const netExpectedEdge = roundFinite(input.evidence.grossExpectedEdge - costDrag, "netExpectedEdge");
  if (netExpectedEdge <= 0) reasons.push("NON_POSITIVE_EDGE_AFTER_COSTS");

  const availablePortfolioWeight = Math.max(
    0,
    policy.maximumPortfolioWeight - input.evidence.currentPortfolioGrossWeight + input.evidence.currentStrategyWeight
  );
  const maximumWeight = roundFinite(Math.min(policy.maximumStrategyWeight, availablePortfolioWeight), "maximumWeight");
  if (maximumWeight <= 0) reasons.push("PORTFOLIO_CONCENTRATION_LIMIT_REACHED");

  const failClosed = reasons.length > 0;
  const recommendedWeight = failClosed ? 0 : maximumWeight;
  requireFinite(recommendedWeight, "recommendedWeight");

  return freezeResult({
    advisoryId: input.advisoryId,
    strategyId: input.strategyId,
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
