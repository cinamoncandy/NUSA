export type EvolutionConfidenceOutcome =
  | "VERIFIED_IMPROVEMENT"
  | "INSUFFICIENT"
  | "REGRESSION"
  | "FAILED";

export interface EvolutionConfidenceEvidence {
  readonly id: string;
  readonly source: string;
  readonly quality: number;
  readonly independent: boolean;
}

export interface EvolutionConfidenceDecision {
  readonly currentConfidence: number;
  readonly requestedConfidence: number;
  readonly allowedConfidence: number;
  readonly increased: boolean;
  readonly reason: "INDEPENDENT_VERIFIED_EVIDENCE" | "NO_INCREASE_REQUESTED" | "INSUFFICIENT_EVIDENCE" | "NEGATIVE_OUTCOME";
  readonly evidenceIds: readonly string[];
  readonly authority: {
    readonly liveAuthority: "NONE";
    readonly productionMutationAllowed: false;
    readonly aiAuthority: "ZERO_AUTHORITY";
  };
}

const bounded = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1;
const ID = /^[A-Za-z0-9_.:/#@-]{1,240}$/;

function validateEvidence(evidence: readonly EvolutionConfidenceEvidence[]): readonly EvolutionConfidenceEvidence[] {
  const seen = new Set<string>();
  return Object.freeze(evidence.map((item) => {
    if (!ID.test(item.id) || !item.source.trim() || seen.has(item.id)) throw new Error("EVOLVE_CONFIDENCE_EVIDENCE_INVALID");
    if (!bounded(item.quality)) throw new Error("EVOLVE_CONFIDENCE_EVIDENCE_QUALITY_INVALID");
    seen.add(item.id);
    return Object.freeze({ ...item, source: item.source.trim() });
  }));
}

/**
 * Fail-closed confidence guard for Evolve decisions.
 * Confidence may increase only after a VERIFIED_IMPROVEMENT backed by at least one
 * independent, high-quality evidence item. Selection, retries, and local success alone
 * cannot manufacture confidence. This contract never grants execution or LIVE authority.
 */
export function guardEvolutionConfidence(input: {
  readonly currentConfidence: number;
  readonly requestedConfidence: number;
  readonly outcome: EvolutionConfidenceOutcome;
  readonly evidence: readonly EvolutionConfidenceEvidence[];
}): EvolutionConfidenceDecision {
  if (!bounded(input.currentConfidence) || !bounded(input.requestedConfidence)) throw new Error("EVOLVE_CONFIDENCE_INVALID");
  const evidence = validateEvidence(input.evidence);
  const wantsIncrease = input.requestedConfidence > input.currentConfidence;
  const negative = input.outcome === "REGRESSION" || input.outcome === "FAILED";
  const hasIndependentVerifiedEvidence = evidence.some((item) => item.independent && item.quality >= 0.8);

  let allowedConfidence = Math.min(input.currentConfidence, input.requestedConfidence);
  let reason: EvolutionConfidenceDecision["reason"] = "NO_INCREASE_REQUESTED";

  if (negative) {
    reason = "NEGATIVE_OUTCOME";
  } else if (wantsIncrease && input.outcome === "VERIFIED_IMPROVEMENT" && hasIndependentVerifiedEvidence) {
    allowedConfidence = input.requestedConfidence;
    reason = "INDEPENDENT_VERIFIED_EVIDENCE";
  } else if (wantsIncrease) {
    allowedConfidence = input.currentConfidence;
    reason = "INSUFFICIENT_EVIDENCE";
  }

  return Object.freeze({
    currentConfidence: input.currentConfidence,
    requestedConfidence: input.requestedConfidence,
    allowedConfidence,
    increased: allowedConfidence > input.currentConfidence,
    reason,
    evidenceIds: Object.freeze(evidence.map((item) => item.id).sort()),
    authority: Object.freeze({ liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }),
  });
}
