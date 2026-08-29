export type PaperPortfolioRiskEvidenceStatus = "VERIFIED" | "INSUFFICIENT" | "UNKNOWN" | "CONFLICTING";
export type PaperPortfolioRiskDecision = "ACCEPT" | "ABSTAIN";

export interface PaperPortfolioRiskEvidenceInput {
  readonly evaluationId: string;
  readonly candidateId: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly observedAt: string;
  readonly evaluatedAt: string;
  readonly status: PaperPortfolioRiskEvidenceStatus;
  readonly evidencePeriods: number;
  readonly minimumEvidencePeriods: number;
  readonly maximumEvidenceAgeMs: number;
  readonly portfolioDrawdownContribution: number;
  readonly maximumDrawdownContribution: number;
  readonly diversificationBenefit: number;
  readonly minimumDiversificationBenefit: number;
}

export interface PaperPortfolioRiskEvidenceResult {
  readonly evaluationId: string;
  readonly decision: PaperPortfolioRiskDecision;
  readonly reasons: readonly string[];
  readonly candidateId: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly observedAt: string;
  readonly evaluatedAt: string;
  readonly portfolioDrawdownContribution: number;
  readonly diversificationBenefit: number;
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

export function evaluatePaperPortfolioRiskEvidence(
  input: PaperPortfolioRiskEvidenceInput,
): PaperPortfolioRiskEvidenceResult {
  if (!input.evaluationId.trim()) throw new Error("evaluationId is required");
  if (!input.candidateId.trim()) throw new Error("candidateId is required");
  if (!input.datasetId.trim()) throw new Error("datasetId is required");
  if (!sha256.test(input.datasetContentSha256)) throw new Error("datasetContentSha256 must be sha256");

  const observedAtMs = Date.parse(input.observedAt);
  const evaluatedAtMs = Date.parse(input.evaluatedAt);
  if (!Number.isFinite(observedAtMs)) throw new Error("observedAt must be a valid ISO timestamp");
  if (!Number.isFinite(evaluatedAtMs)) throw new Error("evaluatedAt must be a valid ISO timestamp");
  if (!Number.isInteger(input.evidencePeriods) || input.evidencePeriods < 0) {
    throw new Error("evidencePeriods must be a non-negative integer");
  }
  if (!Number.isInteger(input.minimumEvidencePeriods) || input.minimumEvidencePeriods <= 0) {
    throw new Error("minimumEvidencePeriods must be a positive integer");
  }
  if (!Number.isFinite(input.maximumEvidenceAgeMs) || input.maximumEvidenceAgeMs < 0) {
    throw new Error("maximumEvidenceAgeMs must be non-negative");
  }

  requireRatio(input.portfolioDrawdownContribution, "portfolioDrawdownContribution");
  requireRatio(input.maximumDrawdownContribution, "maximumDrawdownContribution");
  requireFinite(input.diversificationBenefit, "diversificationBenefit");
  requireFinite(input.minimumDiversificationBenefit, "minimumDiversificationBenefit");

  const reasons: string[] = [];
  if (input.status !== "VERIFIED") reasons.push(`EVIDENCE_${input.status}`);
  if (input.evidencePeriods < input.minimumEvidencePeriods) reasons.push("INSUFFICIENT_LONGITUDINAL_EVIDENCE");
  if (observedAtMs > evaluatedAtMs) reasons.push("FUTURE_EVIDENCE");
  if (evaluatedAtMs - observedAtMs > input.maximumEvidenceAgeMs) reasons.push("STALE_EVIDENCE");
  if (input.portfolioDrawdownContribution > input.maximumDrawdownContribution) {
    reasons.push("DRAWDOWN_CONTRIBUTION_LIMIT_EXCEEDED");
  }
  if (input.diversificationBenefit < input.minimumDiversificationBenefit) {
    reasons.push("INSUFFICIENT_DIVERSIFICATION_BENEFIT");
  }

  return Object.freeze({
    evaluationId: input.evaluationId,
    decision: reasons.length === 0 ? "ACCEPT" : "ABSTAIN",
    reasons: Object.freeze([...reasons].sort()),
    candidateId: input.candidateId,
    datasetId: input.datasetId,
    datasetContentSha256: input.datasetContentSha256,
    observedAt: input.observedAt,
    evaluatedAt: input.evaluatedAt,
    portfolioDrawdownContribution: input.portfolioDrawdownContribution,
    diversificationBenefit: input.diversificationBenefit,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}
