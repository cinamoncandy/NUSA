export type EvolutionOpportunityStatus =
  | "DISCOVERED"
  | "ANALYZING"
  | "PLANNED"
  | "REJECTED"
  | "READY"
  | "EXECUTING"
  | "VALIDATING"
  | "COMPLETED"
  | "FAILED"
  | "ABSTAINED";

export interface EvolutionEvidence {
  readonly source: string;
  readonly reference: string;
  readonly quality: number;
}

export interface EvolutionOpportunity {
  readonly id: string;
  readonly source: string;
  readonly problem: string;
  readonly evidence: readonly EvolutionEvidence[];
  readonly impact: number;
  readonly confidence: number;
  readonly risk: number;
  readonly reversibility: number;
  readonly status: EvolutionOpportunityStatus;
  readonly createdAt: string;
}

const ID = /^[A-Za-z0-9_.:-]{1,160}$/;
const SOURCE = /^[A-Za-z0-9_.:/-]{1,120}$/;
const REFERENCE = /^[A-Za-z0-9_.:/#@-]{1,240}$/;
const bounded = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1;
const VALID_STATUSES: ReadonlySet<EvolutionOpportunityStatus> = new Set([
  "DISCOVERED",
  "ANALYZING",
  "PLANNED",
  "REJECTED",
  "READY",
  "EXECUTING",
  "VALIDATING",
  "COMPLETED",
  "FAILED",
  "ABSTAINED",
]);

export function validateEvolutionOpportunity(value: unknown): EvolutionOpportunity {
  if (!value || typeof value !== "object") throw new Error("EVOLVE_OPPORTUNITY_INVALID");
  const opportunity = value as Partial<EvolutionOpportunity>;
  if (typeof opportunity.id !== "string" || !ID.test(opportunity.id)) throw new Error("EVOLVE_OPPORTUNITY_ID_INVALID");
  if (typeof opportunity.source !== "string" || !SOURCE.test(opportunity.source)) throw new Error("EVOLVE_OPPORTUNITY_SOURCE_INVALID");
  if (typeof opportunity.problem !== "string" || opportunity.problem.trim().length === 0 || opportunity.problem.length > 2000) throw new Error("EVOLVE_OPPORTUNITY_PROBLEM_INVALID");
  if (!Array.isArray(opportunity.evidence) || opportunity.evidence.length === 0) throw new Error("EVOLVE_OPPORTUNITY_EVIDENCE_REQUIRED");
  for (const evidence of opportunity.evidence) {
    if (!evidence || typeof evidence !== "object") throw new Error("EVOLVE_OPPORTUNITY_EVIDENCE_INVALID");
    if (typeof evidence.source !== "string" || !SOURCE.test(evidence.source)) throw new Error("EVOLVE_OPPORTUNITY_EVIDENCE_SOURCE_INVALID");
    if (typeof evidence.reference !== "string" || !REFERENCE.test(evidence.reference)) throw new Error("EVOLVE_OPPORTUNITY_EVIDENCE_REFERENCE_INVALID");
    if (!bounded(evidence.quality)) throw new Error("EVOLVE_OPPORTUNITY_EVIDENCE_QUALITY_INVALID");
  }
  if (!bounded(opportunity.impact ?? NaN)) throw new Error("EVOLVE_OPPORTUNITY_IMPACT_INVALID");
  if (!bounded(opportunity.confidence ?? NaN)) throw new Error("EVOLVE_OPPORTUNITY_CONFIDENCE_INVALID");
  if (!bounded(opportunity.risk ?? NaN)) throw new Error("EVOLVE_OPPORTUNITY_RISK_INVALID");
  if (!bounded(opportunity.reversibility ?? NaN)) throw new Error("EVOLVE_OPPORTUNITY_REVERSIBILITY_INVALID");
  if (typeof opportunity.status !== "string" || !VALID_STATUSES.has(opportunity.status as EvolutionOpportunityStatus)) {
    throw new Error("EVOLVE_OPPORTUNITY_STATUS_INVALID");
  }
  if (typeof opportunity.createdAt !== "string" || Number.isNaN(Date.parse(opportunity.createdAt))) throw new Error("EVOLVE_OPPORTUNITY_CREATED_AT_INVALID");
  return Object.freeze({
    id: opportunity.id,
    source: opportunity.source,
    problem: opportunity.problem.trim(),
    evidence: Object.freeze(opportunity.evidence.map((item) => Object.freeze({ ...item }))),
    impact: opportunity.impact!,
    confidence: opportunity.confidence!,
    risk: opportunity.risk!,
    reversibility: opportunity.reversibility!,
    status: opportunity.status as EvolutionOpportunityStatus,
    createdAt: opportunity.createdAt,
  });
}
