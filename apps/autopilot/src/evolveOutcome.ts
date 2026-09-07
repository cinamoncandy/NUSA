export type EvolutionOutcome =
  | "SUCCESS"
  | "PARTIAL_SUCCESS"
  | "UNDERPERFORMED"
  | "FAILED"
  | "REGRESSION"
  | "UNKNOWN";

export interface EvolutionOutcomeRecord {
  readonly opportunityId: string;
  readonly expectedMetric: number;
  readonly actualMetric: number;
  readonly outcome: EvolutionOutcome;
  readonly observedAt: string;
  readonly evidence: readonly string[];
}

const EVIDENCE_REFERENCE = /^[A-Za-z0-9_.:/#@-]{1,240}$/;

function normalizeEvidenceReference(reference: string): string {
  const normalized = reference.trim();
  if (!EVIDENCE_REFERENCE.test(normalized)) throw new Error("EVOLVE_OUTCOME_EVIDENCE_INVALID");
  return normalized;
}

export function evaluateEvolutionOutcome(input: {
  opportunityId: string;
  expectedMetric: number;
  actualMetric: number;
  tolerance?: number;
  evidence: readonly string[];
  trustedEvidenceReferences: readonly string[];
  observedAt?: string;
}): EvolutionOutcomeRecord {
  if (typeof input.opportunityId !== "string" || !input.opportunityId.trim()) throw new Error("EVOLVE_OUTCOME_OPPORTUNITY_REQUIRED");
  if (!Number.isFinite(input.expectedMetric) || !Number.isFinite(input.actualMetric)) {
    throw new Error("EVOLVE_OUTCOME_METRIC_INVALID");
  }
  if (!Array.isArray(input.evidence) || input.evidence.length === 0) throw new Error("EVOLVE_OUTCOME_EVIDENCE_REQUIRED");
  if (!input.evidence.every((value) => typeof value === "string")) throw new Error("EVOLVE_OUTCOME_EVIDENCE_INVALID");
  if (!Array.isArray(input.trustedEvidenceReferences) || input.trustedEvidenceReferences.length === 0) throw new Error("EVOLVE_OUTCOME_TRUSTED_EVIDENCE_REQUIRED");
  if (!input.trustedEvidenceReferences.every((value) => typeof value === "string")) throw new Error("EVOLVE_OUTCOME_EVIDENCE_INVALID");
  const trustedEvidence = new Set(input.trustedEvidenceReferences.map(normalizeEvidenceReference));
  if (trustedEvidence.size === 0) throw new Error("EVOLVE_OUTCOME_TRUSTED_EVIDENCE_REQUIRED");
  const evidence = input.evidence.map(normalizeEvidenceReference);
  if (evidence.some((reference) => !trustedEvidence.has(reference))) {
    throw new Error("EVOLVE_OUTCOME_EVIDENCE_UNBOUND");
  }
  const observedAt = input.observedAt;
  if (typeof observedAt !== "string" || observedAt.trim().length === 0) {
    throw new Error("EVOLVE_OUTCOME_OBSERVED_AT_REQUIRED");
  }
  if (!Number.isFinite(Date.parse(observedAt))) {
    throw new Error("EVOLVE_OUTCOME_OBSERVED_AT_INVALID");
  }
  const tolerance = input.tolerance ?? Math.max(Math.abs(input.expectedMetric) * 0.1, 0.000001);
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error("EVOLVE_OUTCOME_TOLERANCE_INVALID");
  const delta = input.actualMetric - input.expectedMetric;
  const outcome: EvolutionOutcome =
    Math.abs(delta) <= tolerance ? "SUCCESS" :
    Math.abs(delta) <= tolerance * 2 ? "PARTIAL_SUCCESS" :
    input.actualMetric < input.expectedMetric ? "UNDERPERFORMED" : "REGRESSION";
  return Object.freeze({
    opportunityId: input.opportunityId,
    expectedMetric: input.expectedMetric,
    actualMetric: input.actualMetric,
    outcome,
    observedAt,
    evidence: Object.freeze(evidence),
  });
}
