export type EngineeringEvidenceValue = number | "UNKNOWN";

export type EngineeringOpportunityPriorityInput = {
  opportunityId: string;
  expectedProductValue: EngineeringEvidenceValue;
  riskReduction: EngineeringEvidenceValue;
  evidenceGain: EngineeringEvidenceValue;
  criticalPathUnlock: EngineeringEvidenceValue;
  effortCost: EngineeringEvidenceValue;
  dependencyFanOut: EngineeringEvidenceValue;
  uncertainty: EngineeringEvidenceValue;
};

export type EngineeringOpportunityPriorityDecision = {
  opportunityId: string;
  classification: "RANKABLE" | "INSUFFICIENT";
  score: number | null;
  components: Readonly<{
    expectedProductValue: EngineeringEvidenceValue;
    riskReduction: EngineeringEvidenceValue;
    evidenceGain: EngineeringEvidenceValue;
    criticalPathUnlock: EngineeringEvidenceValue;
    effortCost: EngineeringEvidenceValue;
    dependencyFanOut: EngineeringEvidenceValue;
    uncertainty: EngineeringEvidenceValue;
  }>;
  reasons: readonly string[];
};

const MIN_COMPONENT = 0;
const MAX_COMPONENT = 100;
const SAFE_OPPORTUNITY_ID = /^[A-Za-z0-9._:-]{1,256}$/;

function validateComponent(name: string, value: EngineeringEvidenceValue): void {
  if (value === "UNKNOWN") return;
  if (!Number.isFinite(value) || value < MIN_COMPONENT || value > MAX_COMPONENT) {
    throw new Error(`ENGINEERING_PRIORITY_INVALID_${name.toUpperCase()}`);
  }
}

export function scoreEngineeringOpportunity(
  input: EngineeringOpportunityPriorityInput,
): EngineeringOpportunityPriorityDecision {
  if (input == null || typeof input !== "object" || Array.isArray(input) || typeof input.opportunityId !== "string") {
    throw new Error("ENGINEERING_PRIORITY_MISSING_OPPORTUNITY_ID");
  }
  const opportunityId = input.opportunityId.trim();
  if (!SAFE_OPPORTUNITY_ID.test(opportunityId)) throw new Error("ENGINEERING_PRIORITY_OPPORTUNITY_ID_INVALID");

  const components = {
    expectedProductValue: input.expectedProductValue,
    riskReduction: input.riskReduction,
    evidenceGain: input.evidenceGain,
    criticalPathUnlock: input.criticalPathUnlock,
    effortCost: input.effortCost,
    dependencyFanOut: input.dependencyFanOut,
    uncertainty: input.uncertainty,
  } as const;

  for (const [name, value] of Object.entries(components)) validateComponent(name, value);

  const unknown = Object.entries(components)
    .filter(([, value]) => value === "UNKNOWN")
    .map(([name]) => name)
    .sort();

  if (unknown.length > 0) {
    return {
      opportunityId,
      classification: "INSUFFICIENT",
      score: null,
      components,
      reasons: unknown.map((name) => `UNKNOWN_${name.toUpperCase()}`),
    };
  }

  const known = components as Record<keyof typeof components, number>;
  const benefit =
    known.expectedProductValue * 0.3 +
    known.riskReduction * 0.2 +
    known.evidenceGain * 0.15 +
    known.criticalPathUnlock * 0.2 +
    known.dependencyFanOut * 0.05;
  const penalty = known.effortCost * 0.05 + known.uncertainty * 0.05;
  const score = Math.round((benefit - penalty) * 1000) / 1000;

  return {
    opportunityId,
    classification: "RANKABLE",
    score,
    components,
    reasons: ["DETERMINISTIC_EVIDENCE_SCORE"],
  };
}

export function rankEngineeringOpportunities(
  inputs: readonly EngineeringOpportunityPriorityInput[],
): EngineeringOpportunityPriorityDecision[] {
  if (!Array.isArray(inputs)) throw new Error("ENGINEERING_PRIORITY_INPUTS_INVALID");
  const opportunityIds = new Set<string>();
  for (const input of inputs) {
    if (input == null || typeof input !== "object" || Array.isArray(input) || typeof input.opportunityId !== "string") {
      throw new Error("ENGINEERING_PRIORITY_MISSING_OPPORTUNITY_ID");
    }
    const opportunityId = input.opportunityId.trim();
    if (!SAFE_OPPORTUNITY_ID.test(opportunityId)) throw new Error("ENGINEERING_PRIORITY_OPPORTUNITY_ID_INVALID");
    if (opportunityIds.has(opportunityId)) throw new Error(`ENGINEERING_PRIORITY_DUPLICATE_OPPORTUNITY_ID:${opportunityId}`);
    opportunityIds.add(opportunityId);
  }
  return inputs
    .map(scoreEngineeringOpportunity)
    .sort((left, right) => {
      if (left.classification !== right.classification) return left.classification === "RANKABLE" ? -1 : 1;
      if (left.score !== right.score) return (right.score ?? Number.NEGATIVE_INFINITY) - (left.score ?? Number.NEGATIVE_INFINITY);
      return left.opportunityId.localeCompare(right.opportunityId);
    });
}
