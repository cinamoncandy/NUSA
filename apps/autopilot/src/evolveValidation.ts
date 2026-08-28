export type EvolutionValidationStatus = "PASS" | "FAIL" | "INSUFFICIENT" | "ABSTAIN";

export interface EvolutionValidationEvidence {
  readonly check: string;
  readonly reference: string;
  readonly passed: boolean;
}

export interface EvolutionValidationResult {
  readonly opportunityId: string;
  readonly status: EvolutionValidationStatus;
  readonly exactHeadSha: string;
  readonly evidence: readonly EvolutionValidationEvidence[];
  readonly reason: string;
}

const SHA = /^[0-9a-f]{40}$/;

export function createEvolutionValidationResult(input: {
  opportunityId: string;
  status: EvolutionValidationStatus;
  exactHeadSha: string;
  evidence: readonly EvolutionValidationEvidence[];
  reason: string;
}): EvolutionValidationResult {
  if (!input.opportunityId.trim()) throw new Error("EVOLVE_VALIDATION_OPPORTUNITY_REQUIRED");
  if (!SHA.test(input.exactHeadSha)) throw new Error("EVOLVE_VALIDATION_HEAD_SHA_INVALID");
  if (input.evidence.length === 0) throw new Error("EVOLVE_VALIDATION_EVIDENCE_REQUIRED");
  if (!input.reason.trim()) throw new Error("EVOLVE_VALIDATION_REASON_REQUIRED");
  return Object.freeze({
    opportunityId: input.opportunityId,
    status: input.status,
    exactHeadSha: input.exactHeadSha,
    evidence: Object.freeze(input.evidence.map((item) => Object.freeze({ ...item }))),
    reason: input.reason.trim(),
  });
}

export function isPromotionEligible(result: EvolutionValidationResult): boolean {
  return result.status === "PASS" && result.evidence.length > 0;
}
