import type { EvolutionOpportunity } from "./evolveOpportunity";

export type EvolutionPlanStatus = "PLANNED" | "ABSTAINED";

export interface EvolutionPlan {
  readonly opportunityId: string;
  readonly hypothesis: string;
  readonly expectedOutcome: string;
  readonly implementationSteps: readonly string[];
  readonly validationSteps: readonly string[];
  readonly rollbackPlan: string;
  readonly status: EvolutionPlanStatus;
  readonly reason: string;
}

const clean = (value: string, max: number): string => value.trim().slice(0, max);

const nonEmpty = (values: readonly string[], max: number): readonly string[] =>
  Object.freeze(values.map((value) => clean(value, max)).filter(Boolean));

export function planEvolutionOpportunity(opportunity: EvolutionOpportunity): EvolutionPlan {
  if (opportunity.status !== "DISCOVERED" && opportunity.status !== "READY") {
    return Object.freeze({
      opportunityId: opportunity.id,
      hypothesis: "",
      expectedOutcome: "",
      implementationSteps: Object.freeze([]),
      validationSteps: Object.freeze([]),
      rollbackPlan: "",
      status: "ABSTAINED",
      reason: "opportunity-status-not-plannable",
    });
  }

  const hypothesis = `Address ${clean(opportunity.problem, 400)} with a bounded, reversible change.`;
  const expectedOutcome = `Reduce the observed problem without weakening safety invariants.`;
  const implementationSteps = nonEmpty([
    "Inspect the evidence and affected component.",
    "Implement the smallest reversible change that tests the hypothesis.",
    "Create a PR with exact execution and provenance metadata.",
  ], 500);
  const validationSteps = nonEmpty([
    "Run focused regression tests.",
    "Run typecheck, build, safety and architecture gates.",
    "Verify exact-head CI and required evidence before promotion.",
  ], 500);
  const rollbackPlan = "Revert the exact PR revision if validation or post-deployment evidence shows regression.";

  return Object.freeze({
    opportunityId: opportunity.id,
    hypothesis,
    expectedOutcome,
    implementationSteps,
    validationSteps,
    rollbackPlan,
    status: "PLANNED",
    reason: "bounded-evidence-plan",
  });
}
