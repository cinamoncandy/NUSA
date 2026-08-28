import type { EvolutionOutcome } from "./evolveOutcome";

export interface EvolutionLearningRecord {
  readonly opportunityId: string;
  readonly problem: string;
  readonly evidenceReferences: readonly string[];
  readonly hypothesis: string;
  readonly changeReference: string;
  readonly validationStatus: string;
  readonly outcome: EvolutionOutcome["status"];
  readonly failureReason: string | null;
  readonly rollbackReference: string | null;
  readonly reusable: boolean;
  readonly recordedAt: string;
}

const clean = (value: string, max: number): string => value.trim().slice(0, max);

export function createEvolutionLearningRecord(input: EvolutionLearningRecord): EvolutionLearningRecord {
  if (!clean(input.opportunityId, 160)) throw new Error("EVOLVE_MEMORY_OPPORTUNITY_REQUIRED");
  if (!clean(input.problem, 2000)) throw new Error("EVOLVE_MEMORY_PROBLEM_REQUIRED");
  if (!input.evidenceReferences.length) throw new Error("EVOLVE_MEMORY_EVIDENCE_REQUIRED");
  if (!clean(input.hypothesis, 2000)) throw new Error("EVOLVE_MEMORY_HYPOTHESIS_REQUIRED");
  if (!clean(input.changeReference, 240)) throw new Error("EVOLVE_MEMORY_CHANGE_REQUIRED");
  if (!clean(input.validationStatus, 80)) throw new Error("EVOLVE_MEMORY_VALIDATION_REQUIRED");
  if (Number.isNaN(Date.parse(input.recordedAt))) throw new Error("EVOLVE_MEMORY_RECORDED_AT_INVALID");

  return Object.freeze({
    ...input,
    opportunityId: clean(input.opportunityId, 160),
    problem: clean(input.problem, 2000),
    evidenceReferences: Object.freeze(input.evidenceReferences.map((value) => clean(value, 240)).filter(Boolean)),
    hypothesis: clean(input.hypothesis, 2000),
    changeReference: clean(input.changeReference, 240),
    validationStatus: clean(input.validationStatus, 80),
    failureReason: input.failureReason ? clean(input.failureReason, 1000) : null,
    rollbackReference: input.rollbackReference ? clean(input.rollbackReference, 240) : null,
  });
}
