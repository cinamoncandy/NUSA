export interface EvolutionCandidate {
  readonly candidateId: string;
  readonly parentId?: string;
  readonly netReturn: number;
  readonly maximumDrawdown: number;
  readonly evidenceComplete: boolean;
  readonly paperValidated: boolean;
}

export interface EvolutionPolicy {
  readonly maximumDrawdown: number;
  readonly minimumImprovement: number;
}

export interface EvolutionResult {
  readonly candidateId: string;
  readonly decision: "RECOMMEND_REVIEW" | "REJECT";
  readonly reasons: readonly string[];
  readonly automaticPromotionAllowed: false;
}

export const evaluateEvolution = (parent: EvolutionCandidate, candidate: EvolutionCandidate, policy: EvolutionPolicy): EvolutionResult => {
  if (!parent.candidateId.trim() || !candidate.candidateId.trim() || candidate.candidateId === parent.candidateId) throw new Error("evolution candidate identity is invalid");
  if (candidate.parentId !== parent.candidateId) throw new Error("candidate parent mismatch");
  if (!Number.isFinite(parent.netReturn) || !Number.isFinite(candidate.netReturn) || !Number.isFinite(candidate.maximumDrawdown) || candidate.maximumDrawdown < 0 || candidate.maximumDrawdown > 1) throw new Error("evolution metrics are invalid");
  if (!Number.isFinite(policy.maximumDrawdown) || policy.maximumDrawdown < 0 || policy.maximumDrawdown > 1 || !Number.isFinite(policy.minimumImprovement) || policy.minimumImprovement < 0) throw new Error("evolution policy is invalid");
  const reasons: string[] = [];
  if (!candidate.evidenceComplete) reasons.push("EVIDENCE_INCOMPLETE");
  if (!candidate.paperValidated) reasons.push("PAPER_VALIDATION_MISSING");
  if (candidate.maximumDrawdown > policy.maximumDrawdown) reasons.push("DRAWDOWN_LIMIT_EXCEEDED");
  if (candidate.netReturn - parent.netReturn < policy.minimumImprovement) reasons.push("IMPROVEMENT_INSUFFICIENT");
  return Object.freeze({ candidateId: candidate.candidateId, decision: reasons.length === 0 ? "RECOMMEND_REVIEW" : "REJECT", reasons: Object.freeze(reasons), automaticPromotionAllowed: false });
};
