import type { StrategyEvolutionAdvisoryResult } from "./strategyEvolutionAdvisory";

export type ResearchFeedbackAction =
  | "PRIORITIZE_CALIBRATION"
  | "PRIORITIZE_REGIME_ROBUSTNESS"
  | "PRIORITIZE_COST_ROBUSTNESS"
  | "PRIORITIZE_DRAWDOWN_CONTROL"
  | "PRIORITIZE_PROVENANCE_REPAIR"
  | "PRIORITIZE_INFRASTRUCTURE_REPAIR"
  | "PRIORITIZE_REPLACEMENT_RESEARCH"
  | "MAINTAIN_CURRENT_RESEARCH";

export interface ResearchEvolutionFeedbackInput {
  readonly feedbackId: string;
  readonly advisory: StrategyEvolutionAdvisoryResult;
}

export interface ResearchEvolutionFeedbackResult {
  readonly feedbackId: string;
  readonly candidateId: string;
  readonly strategyFamilyId: string;
  readonly regime: string;
  readonly actions: readonly ResearchFeedbackAction[];
  readonly reasons: readonly string[];
  readonly researchPriorityMutationAllowed: false;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

const freeze = <T>(value: T): T => Object.freeze(value);

function validate(input: ResearchEvolutionFeedbackInput): void {
  if (!input.feedbackId.trim()) throw new Error("feedbackId is required");
  const advisory = input.advisory;
  if (!advisory.candidateId.trim() || !advisory.strategyFamilyId.trim() || !advisory.regime.trim()) {
    throw new Error("advisory identity is incomplete");
  }
  if (advisory.liveAuthority !== "NONE" || advisory.productionMutationAllowed !== false || advisory.aiAuthority !== "ZERO_AUTHORITY") {
    throw new Error("advisory authority invariant failed");
  }
}

/**
 * Projects lifecycle evidence into deterministic research priorities only.
 * This is advisory data: it cannot schedule research, mutate candidate state,
 * change safety policy, grant LIVE authority, or alter capital permissions.
 */
export function buildResearchEvolutionFeedback(
  input: ResearchEvolutionFeedbackInput,
): ResearchEvolutionFeedbackResult {
  validate(input);
  const reasons = new Set(input.advisory.reasons);
  const actions = new Set<ResearchFeedbackAction>();

  if (reasons.has("CALIBRATION_DETERIORATION")) actions.add("PRIORITIZE_CALIBRATION");
  if (reasons.has("REGIME_DEGRADATION") || reasons.has("EVIDENCE_UNCERTAIN_FAIL_CLOSED")) {
    actions.add("PRIORITIZE_REGIME_ROBUSTNESS");
  }
  if (reasons.has("COST_EROSION")) actions.add("PRIORITIZE_COST_ROBUSTNESS");
  if (reasons.has("DRAWDOWN_DETERIORATION")) actions.add("PRIORITIZE_DRAWDOWN_CONTROL");
  if (reasons.has("PROVENANCE_FAILURE")) actions.add("PRIORITIZE_PROVENANCE_REPAIR");
  if (reasons.has("INFRASTRUCTURE_FAILURE")) actions.add("PRIORITIZE_INFRASTRUCTURE_REPAIR");
  if (input.advisory.recommendation === "RETIRE" || reasons.has("STRUCTURALLY_DOMINATED")) {
    actions.add("PRIORITIZE_REPLACEMENT_RESEARCH");
  }
  if (actions.size === 0) actions.add("MAINTAIN_CURRENT_RESEARCH");

  return freeze({
    feedbackId: input.feedbackId,
    candidateId: input.advisory.candidateId,
    strategyFamilyId: input.advisory.strategyFamilyId,
    regime: input.advisory.regime,
    actions: freeze([...actions].sort()),
    reasons: freeze([...reasons].sort()),
    researchPriorityMutationAllowed: false,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}
