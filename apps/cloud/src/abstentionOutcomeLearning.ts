import { createHash } from "node:crypto";

export type AbstentionOutcomeEvidenceStatus = "VERIFIED" | "INSUFFICIENT" | "UNKNOWN" | "CONFLICTING";
export type AbstentionOutcomeClassification =
  | "CORRECT_ABSTENTION"
  | "POTENTIAL_MISSED_OPPORTUNITY"
  | "AMBIGUOUS"
  | "INSUFFICIENT_EVIDENCE";
export type AbstentionResearchAction =
  | "REVIEW_ABSTENTION_THRESHOLD"
  | "REINFORCE_ABSTENTION_POLICY"
  | "COLLECT_MORE_EVIDENCE"
  | "NO_CHANGE";

export interface PaperAbstentionOutcomeObservation {
  readonly observationId: string;
  readonly candidateId: string;
  readonly strategyFamilyId: string;
  readonly regime: string;
  readonly abstainedAt: string;
  readonly observedAt: string;
  readonly abstentionReasons: readonly string[];
  readonly counterfactualGrossReturn: number;
  readonly estimatedRoundTripCost: number;
  readonly counterfactualAdverseExcursion: number;
  readonly evidenceStatus: AbstentionOutcomeEvidenceStatus;
  readonly source: "PAPER";
  readonly independentEvidenceId: string;
}

export interface AbstentionOutcomeLearningInput {
  readonly learningId: string;
  readonly evaluatedAt: string;
  readonly maximumEvidenceAgeMs: number;
  readonly missedOpportunityThreshold: number;
  readonly materialAdverseExcursionThreshold: number;
  readonly observation: PaperAbstentionOutcomeObservation;
}

export interface AbstentionOutcomeLearningResult {
  readonly learningId: string;
  readonly candidateId: string;
  readonly strategyFamilyId: string;
  readonly regime: string;
  readonly classification: AbstentionOutcomeClassification;
  readonly researchAction: AbstentionResearchAction;
  readonly counterfactualNetReturn: number | null;
  readonly reasons: readonly string[];
  readonly evidenceFingerprintSha256: string | null;
  readonly realizedPnlClaimAllowed: false;
  readonly lifecycleMutationAllowed: false;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

const freeze = <T>(value: T): T => Object.freeze(value);
const finite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
};
const nonNegative = (value: number, label: string): void => {
  finite(value, label);
  if (value < 0) throw new Error(`${label} must be non-negative`);
};
const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    finite(value, "abstention evidence number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  throw new Error("unsupported abstention evidence value");
}

const digest = (value: unknown): string => createHash("sha256").update(canonical(value), "utf8").digest("hex");

function validate(input: AbstentionOutcomeLearningInput): { evaluatedAtMs: number; abstainedAtMs: number; observedAtMs: number } {
  const observation = input.observation;
  if (!input.learningId.trim() || !observation.observationId.trim() || !observation.candidateId.trim()
    || !observation.strategyFamilyId.trim() || !observation.regime.trim() || !observation.independentEvidenceId.trim()) {
    throw new Error("abstention outcome identity is required");
  }
  const evaluatedAtMs = Date.parse(input.evaluatedAt);
  const abstainedAtMs = Date.parse(observation.abstainedAt);
  const observedAtMs = Date.parse(observation.observedAt);
  if (![evaluatedAtMs, abstainedAtMs, observedAtMs].every(Number.isFinite)) throw new Error("abstention timestamps must be valid ISO timestamps");
  nonNegative(input.maximumEvidenceAgeMs, "maximumEvidenceAgeMs");
  nonNegative(input.missedOpportunityThreshold, "missedOpportunityThreshold");
  nonNegative(input.materialAdverseExcursionThreshold, "materialAdverseExcursionThreshold");
  finite(observation.counterfactualGrossReturn, "counterfactualGrossReturn");
  nonNegative(observation.estimatedRoundTripCost, "estimatedRoundTripCost");
  nonNegative(observation.counterfactualAdverseExcursion, "counterfactualAdverseExcursion");
  if (observation.source !== "PAPER") throw new Error("only PAPER abstention evidence may be learned from");
  return { evaluatedAtMs, abstainedAtMs, observedAtMs };
}

/**
 * Evaluates a PAPER-only counterfactual after an ABSTAIN decision.
 * Counterfactual returns are never represented as realized PnL and can only
 * produce advisory research feedback. This function cannot mutate lifecycle,
 * execution, capital, credentials, or LIVE authority.
 */
export function learnFromPaperAbstentionOutcome(input: AbstentionOutcomeLearningInput): AbstentionOutcomeLearningResult {
  const { evaluatedAtMs, abstainedAtMs, observedAtMs } = validate(input);
  const observation = input.observation;
  const reasons: string[] = [];

  if (observedAtMs < abstainedAtMs) reasons.push("OUTCOME_PRECEDES_ABSTENTION");
  if (observedAtMs > evaluatedAtMs) reasons.push("FUTURE_EVIDENCE");
  if (evaluatedAtMs - observedAtMs > input.maximumEvidenceAgeMs) reasons.push("STALE_EVIDENCE");
  if (observation.evidenceStatus !== "VERIFIED") reasons.push(`EVIDENCE_${observation.evidenceStatus}`);
  if (observation.abstentionReasons.length === 0 || observation.abstentionReasons.some((reason) => !reason.trim())) {
    reasons.push("ABSTENTION_REASON_PROVENANCE_MISSING");
  }

  const hardFail = reasons.length > 0;
  let classification: AbstentionOutcomeClassification = "INSUFFICIENT_EVIDENCE";
  let researchAction: AbstentionResearchAction = "COLLECT_MORE_EVIDENCE";
  let counterfactualNetReturn: number | null = null;
  let evidenceFingerprintSha256: string | null = null;

  if (!hardFail) {
    counterfactualNetReturn = round(observation.counterfactualGrossReturn - observation.estimatedRoundTripCost);
    const materialMiss = counterfactualNetReturn >= input.missedOpportunityThreshold;
    const materialRisk = observation.counterfactualAdverseExcursion >= input.materialAdverseExcursionThreshold;

    if (materialMiss && !materialRisk) {
      classification = "POTENTIAL_MISSED_OPPORTUNITY";
      researchAction = "REVIEW_ABSTENTION_THRESHOLD";
      reasons.push("COUNTERFACTUAL_NET_EDGE_AFTER_COSTS");
    } else if (!materialMiss && materialRisk) {
      classification = "CORRECT_ABSTENTION";
      researchAction = "REINFORCE_ABSTENTION_POLICY";
      reasons.push("ABSTENTION_AVOIDED_MATERIAL_RISK");
    } else if (!materialMiss && !materialRisk) {
      classification = "CORRECT_ABSTENTION";
      researchAction = "NO_CHANGE";
      reasons.push("NO_MATERIAL_MISSED_EDGE");
    } else {
      classification = "AMBIGUOUS";
      researchAction = "COLLECT_MORE_EVIDENCE";
      reasons.push("EDGE_AND_RISK_BOTH_MATERIAL");
    }

    evidenceFingerprintSha256 = digest({
      observationId: observation.observationId,
      candidateId: observation.candidateId,
      strategyFamilyId: observation.strategyFamilyId,
      regime: observation.regime,
      abstainedAt: observation.abstainedAt,
      observedAt: observation.observedAt,
      abstentionReasons: [...observation.abstentionReasons].sort(),
      counterfactualGrossReturn: observation.counterfactualGrossReturn,
      estimatedRoundTripCost: observation.estimatedRoundTripCost,
      counterfactualAdverseExcursion: observation.counterfactualAdverseExcursion,
      independentEvidenceId: observation.independentEvidenceId,
    });
  }

  return freeze({
    learningId: input.learningId,
    candidateId: observation.candidateId,
    strategyFamilyId: observation.strategyFamilyId,
    regime: observation.regime,
    classification,
    researchAction,
    counterfactualNetReturn,
    reasons: freeze([...new Set(reasons)].sort()),
    evidenceFingerprintSha256,
    realizedPnlClaimAllowed: false,
    lifecycleMutationAllowed: false,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}
