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

export function evaluateEvolutionOutcome(input: {
  opportunityId: string;
  expectedMetric: number;
  actualMetric: number;
  tolerance?: number;
  evidence: readonly string[];
  observedAt?: string;
}): EvolutionOutcomeRecord {
  if (!input.opportunityId.trim()) throw new Error("EVOLVE_OUTCOME_OPPORTUNITY_REQUIRED");
  if (!Number.isFinite(input.expectedMetric) || !Number.isFinite(input.actualMetric)) {
    throw new Error("EVOLVE_OUTCOME_METRIC_INVALID");
  }
  if (input.evidence.length === 0) throw new Error("EVOLVE_OUTCOME_EVIDENCE_REQUIRED");
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
    observedAt: input.observedAt ?? new Date().toISOString(),
    evidence: Object.freeze([...input.evidence]),
  });
}
