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

const REFERENCE = /^[A-Za-z0-9_.:/#@-]{1,240}$/;
const VALID_STATUSES: ReadonlySet<EvolutionValidationStatus> = new Set([
  "PASS",
  "FAIL",
  "INSUFFICIENT",
  "ABSTAIN",
]);

export function validateEvolutionValidationResult(value: unknown): EvolutionValidationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("EVOLVE_VALIDATION_INVALID");
  }
  const result = value as Partial<EvolutionValidationResult>;
  if (typeof result.opportunityId !== "string" || !result.opportunityId.trim()) {
    throw new Error("EVOLVE_VALIDATION_OPPORTUNITY_REQUIRED");
  }
  if (typeof result.status !== "string" || !VALID_STATUSES.has(result.status as EvolutionValidationStatus)) {
    throw new Error("EVOLVE_VALIDATION_STATUS_INVALID");
  }
  if (typeof result.exactHeadSha !== "string" || !SHA.test(result.exactHeadSha)) {
    throw new Error("EVOLVE_VALIDATION_HEAD_SHA_INVALID");
  }
  if (!Array.isArray(result.evidence) || result.evidence.length === 0) {
    throw new Error("EVOLVE_VALIDATION_EVIDENCE_REQUIRED");
  }
  const evidence = result.evidence.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("EVOLVE_VALIDATION_EVIDENCE_INVALID");
    }
    const candidate = item as Partial<EvolutionValidationEvidence>;
    if (typeof candidate.check !== "string" || !candidate.check.trim() || candidate.check.length > 160) {
      throw new Error("EVOLVE_VALIDATION_CHECK_INVALID");
    }
    if (typeof candidate.reference !== "string" || !REFERENCE.test(candidate.reference)) {
      throw new Error("EVOLVE_VALIDATION_REFERENCE_INVALID");
    }
    if (typeof candidate.passed !== "boolean") {
      throw new Error("EVOLVE_VALIDATION_RESULT_INVALID");
    }
    return Object.freeze({
      check: candidate.check.trim(),
      reference: candidate.reference,
      passed: candidate.passed,
    });
  });
  if (typeof result.reason !== "string" || !result.reason.trim()) {
    throw new Error("EVOLVE_VALIDATION_REASON_REQUIRED");
  }
  return Object.freeze({
    opportunityId: result.opportunityId.trim(),
    status: result.status as EvolutionValidationStatus,
    exactHeadSha: result.exactHeadSha,
    evidence: Object.freeze(evidence),
    reason: result.reason.trim(),
  });
}
export function createEvolutionValidationResult(input: {
  opportunityId: string;
  status: EvolutionValidationStatus;
  exactHeadSha: string;
  evidence: readonly EvolutionValidationEvidence[];
  reason: string;
}): EvolutionValidationResult {
  return validateEvolutionValidationResult(input);
}

export function isPromotionEligible(result: EvolutionValidationResult): boolean {
  return result.status === "PASS" && result.evidence.length > 0 && result.evidence.every((item) => item.passed);
}
