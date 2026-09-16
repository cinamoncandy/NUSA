import type { CommitteeOpinion, CommitteeSafetyContext } from "../../../packages/contracts/src/investmentCommittee";
import { evaluateInvestmentCommittee, type CommitteeWeights } from "./investmentCommittee";

export interface ReviewCheckV10 {
  readonly id: string;
  readonly status: "PASS" | "WARN" | "FAIL";
  readonly reason: string;
}

export interface ReviewEngineV10Input {
  readonly opinions: readonly CommitteeOpinion[];
  readonly weights: CommitteeWeights;
  readonly safety: CommitteeSafetyContext;
  readonly decidedAt: number;
  readonly checks: readonly ReviewCheckV10[];
}

export interface ReviewEngineV10Output {
  readonly decision: "PAPER_APPROVED" | "WAIT" | "REJECT" | "EMERGENCY_EXIT";
  readonly authority: "PAPER_RESEARCH_ONLY";
  readonly committee: ReturnType<typeof evaluateInvestmentCommittee>;
  readonly checks: readonly ReviewCheckV10[];
  readonly reasons: readonly string[];
  readonly reviewedAt: number;
}

export function runReviewEngineV10(input: ReviewEngineV10Input): ReviewEngineV10Output {
  const ids = new Set<string>();
  const checks = [...input.checks].map((check) => {
    if (!check.id.trim()) throw new Error("review check id is required");
    if (ids.has(check.id)) throw new Error(`duplicate review check id: ${check.id}`);
    ids.add(check.id);
    if (!check.reason.trim()) throw new Error(`review check reason is required: ${check.id}`);
    return Object.freeze({ ...check, id: check.id.trim(), reason: check.reason.trim() });
  }).sort((left, right) => left.id.localeCompare(right.id));

  const committee = evaluateInvestmentCommittee(input.opinions, input.weights, input.safety, input.decidedAt);
  const failed = checks.filter((check) => check.status === "FAIL");
  const warnings = checks.filter((check) => check.status === "WARN");
  const reasons = [
    ...committee.reasons,
    ...failed.map((check) => `CHECK_FAILED:${check.id}`),
    ...warnings.map((check) => `CHECK_WARN:${check.id}`)
  ].sort();

  let decision: ReviewEngineV10Output["decision"];
  if (committee.decision === "EMERGENCY_EXIT") decision = "EMERGENCY_EXIT";
  else if (failed.length > 0 || committee.decision === "REJECT") decision = "REJECT";
  else if (committee.decision === "WAIT") decision = "WAIT";
  else decision = "PAPER_APPROVED";

  return Object.freeze({
    decision,
    authority: "PAPER_RESEARCH_ONLY",
    committee,
    checks: Object.freeze(checks),
    reasons: Object.freeze(reasons),
    reviewedAt: input.decidedAt
  });
}
