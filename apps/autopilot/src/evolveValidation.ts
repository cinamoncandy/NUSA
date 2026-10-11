export type EvolutionValidationStatus = "PASS" | "FAIL" | "INSUFFICIENT" | "ABSTAIN";

export interface EvolutionValidationEvidence {
  readonly check: string;
  readonly reference: string;
  readonly passed: boolean;
}

export interface EvolutionBenefitCostEvidence {
  readonly telemetryReference: string;
  readonly budgetState: "NORMAL" | "CONSERVE" | "HARD_STOP";
  readonly baselineBenefit: number;
  readonly observedBenefit: number;
  readonly baselineCost: number;
  readonly observedCost: number;
  readonly benefitDelta: number;
  readonly costDelta: number;
  readonly netBenefitDelta: number;
  readonly passed: boolean;
}

export interface EvolutionValidationResult {
  readonly opportunityId: string;
  readonly status: EvolutionValidationStatus;
  readonly exactHeadSha: string;
  readonly evidence: readonly EvolutionValidationEvidence[];
  readonly heldOutEvidence: readonly EvolutionValidationEvidence[];
  readonly benefitCostEvidence: readonly EvolutionBenefitCostEvidence[];
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
  if (!Array.isArray(result.heldOutEvidence) || result.heldOutEvidence.length === 0) {
    throw new Error("EVOLVE_VALIDATION_HELD_OUT_EVIDENCE_REQUIRED");
  }
  const constructionReferences = new Set(evidence.map((item) => item.reference));
  const heldOutEvidence = result.heldOutEvidence.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("EVOLVE_VALIDATION_HELD_OUT_EVIDENCE_INVALID");
    const candidate = item as Partial<EvolutionValidationEvidence>;
    if (typeof candidate.check !== "string" || !candidate.check.trim() || !/held.?out|generalization/i.test(candidate.check) || candidate.check.length > 160) {
      throw new Error("EVOLVE_VALIDATION_HELD_OUT_CHECK_INVALID");
    }
    if (typeof candidate.reference !== "string" || !REFERENCE.test(candidate.reference) || constructionReferences.has(candidate.reference)) {
      throw new Error("EVOLVE_VALIDATION_HELD_OUT_REFERENCE_INVALID");
    }
    if (typeof candidate.passed !== "boolean") throw new Error("EVOLVE_VALIDATION_HELD_OUT_RESULT_INVALID");
    return Object.freeze({ check: candidate.check.trim(), reference: candidate.reference, passed: candidate.passed });
  });

  if (!Array.isArray(result.benefitCostEvidence) || result.benefitCostEvidence.length === 0) {
    throw new Error("EVOLVE_VALIDATION_BENEFIT_COST_EVIDENCE_REQUIRED");
  }
  const benefitCostEvidence = result.benefitCostEvidence.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("EVOLVE_VALIDATION_BENEFIT_COST_INVALID");
    const candidate = item as Partial<EvolutionBenefitCostEvidence>;
    if (typeof candidate.telemetryReference !== "string" || !REFERENCE.test(candidate.telemetryReference)) throw new Error("EVOLVE_VALIDATION_COST_TELEMETRY_REFERENCE_INVALID");
    if (candidate.budgetState !== "NORMAL" && candidate.budgetState !== "CONSERVE" && candidate.budgetState !== "HARD_STOP") throw new Error("EVOLVE_VALIDATION_COST_BUDGET_STATE_INVALID");
    const numbers = [candidate.baselineBenefit, candidate.observedBenefit, candidate.baselineCost, candidate.observedCost, candidate.benefitDelta, candidate.costDelta, candidate.netBenefitDelta];
    if (numbers.some((value) => typeof value !== "number" || !Number.isFinite(value))) throw new Error("EVOLVE_VALIDATION_COST_NUMBER_INVALID");
    if (candidate.baselineCost! < 0 || candidate.observedCost! < 0) throw new Error("EVOLVE_VALIDATION_COST_NEGATIVE");
    const scale = Math.max(1, Math.abs(candidate.benefitDelta!), Math.abs(candidate.costDelta!), Math.abs(candidate.netBenefitDelta!));
    const close = (a: number, b: number) => Math.abs(a - b) <= Number.EPSILON * 32 * scale;
    if (!close(candidate.benefitDelta!, candidate.observedBenefit! - candidate.baselineBenefit!)
      || !close(candidate.costDelta!, candidate.observedCost! - candidate.baselineCost!)
      || !close(candidate.netBenefitDelta!, candidate.benefitDelta! - candidate.costDelta!)
      || candidate.passed !== (candidate.netBenefitDelta! > 0)) {
      throw new Error("EVOLVE_VALIDATION_COST_EVIDENCE_NONDETERMINISTIC");
    }
    return Object.freeze({ ...candidate }) as EvolutionBenefitCostEvidence;
  });

  if (typeof result.reason !== "string" || !result.reason.trim()) {
    throw new Error("EVOLVE_VALIDATION_REASON_REQUIRED");
  }
  return Object.freeze({
    opportunityId: result.opportunityId.trim(),
    status: result.status as EvolutionValidationStatus,
    exactHeadSha: result.exactHeadSha,
    evidence: Object.freeze(evidence),
    heldOutEvidence: Object.freeze(heldOutEvidence),
    benefitCostEvidence: Object.freeze(benefitCostEvidence),
    reason: result.reason.trim(),
  });
}
export function createEvolutionValidationResult(input: {
  opportunityId: string;
  status: EvolutionValidationStatus;
  exactHeadSha: string;
  evidence: readonly EvolutionValidationEvidence[];
  heldOutEvidence: readonly EvolutionValidationEvidence[];
  benefitCostEvidence: readonly EvolutionBenefitCostEvidence[];
  reason: string;
}): EvolutionValidationResult {
  return validateEvolutionValidationResult(input);
}

export function isPromotionEligible(result: EvolutionValidationResult): boolean {
  return result.status === "PASS"
    && result.evidence.length > 0
    && result.evidence.every((item) => item.passed)
    && result.heldOutEvidence.length > 0
    && result.heldOutEvidence.every((item) => item.passed)
    && result.benefitCostEvidence.length > 0
    && result.benefitCostEvidence.every((item) => item.passed);
}
