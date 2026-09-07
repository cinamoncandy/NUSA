import type { EvolutionOutcome } from "./evolveOutcome";

export interface EvolutionLearningRecord {
  readonly opportunityId: string;
  readonly problem: string;
  readonly evidenceReferences: readonly string[];
  readonly hypothesis: string;
  readonly changeReference: string;
  readonly validationStatus: string;
  readonly outcome: EvolutionOutcome;
  readonly failureReason: string | null;
  readonly rollbackReference: string | null;
  readonly reusable: boolean;
  readonly recordedAt: string;
}

/**
 * Persistence is an injected evidence sink. The evolution coordinator does not
 * select a store, create a database, or gain any execution capability from it.
 */
export interface EvolutionLearningMemoryRepository {
  append(record: EvolutionLearningRecord): void;
  list(): readonly EvolutionLearningRecord[];
}

const clean = (value: string, max: number): string => value.trim().slice(0, max);

const OUTCOMES = new Set<EvolutionOutcome>([
  "SUCCESS",
  "PARTIAL_SUCCESS",
  "UNDERPERFORMED",
  "FAILED",
  "REGRESSION",
  "UNKNOWN",
]);

export function createEvolutionLearningRecord(input: EvolutionLearningRecord): EvolutionLearningRecord {
  if (!OUTCOMES.has(input.outcome)) throw new Error("EVOLVE_MEMORY_OUTCOME_INVALID");
  if (typeof input.reusable !== "boolean") throw new Error("EVOLVE_MEMORY_REUSABLE_INVALID");
  if (input.failureReason !== null && typeof input.failureReason !== "string") throw new Error("EVOLVE_MEMORY_FAILURE_REASON_INVALID");
  if (input.rollbackReference !== null && typeof input.rollbackReference !== "string") throw new Error("EVOLVE_MEMORY_ROLLBACK_REFERENCE_INVALID");
  if (!clean(input.opportunityId, 160)) throw new Error("EVOLVE_MEMORY_OPPORTUNITY_REQUIRED");
  if (!clean(input.problem, 2000)) throw new Error("EVOLVE_MEMORY_PROBLEM_REQUIRED");
  if (!input.evidenceReferences.length) throw new Error("EVOLVE_MEMORY_EVIDENCE_REQUIRED");
  if (!clean(input.hypothesis, 2000)) throw new Error("EVOLVE_MEMORY_HYPOTHESIS_REQUIRED");
  if (!clean(input.changeReference, 240)) throw new Error("EVOLVE_MEMORY_CHANGE_REQUIRED");
  if (!clean(input.validationStatus, 80)) throw new Error("EVOLVE_MEMORY_VALIDATION_REQUIRED");
  if (Number.isNaN(Date.parse(input.recordedAt))) throw new Error("EVOLVE_MEMORY_RECORDED_AT_INVALID");

  const evidenceReferences = input.evidenceReferences.map((value) => clean(value, 240)).filter(Boolean);
  if (!evidenceReferences.length) throw new Error("EVOLVE_MEMORY_EVIDENCE_REQUIRED");

  return Object.freeze({
    ...input,
    opportunityId: clean(input.opportunityId, 160),
    problem: clean(input.problem, 2000),
    evidenceReferences: Object.freeze(evidenceReferences),
    hypothesis: clean(input.hypothesis, 2000),
    changeReference: clean(input.changeReference, 240),
    validationStatus: clean(input.validationStatus, 80),
    failureReason: input.failureReason ? clean(input.failureReason, 1000) : null,
    rollbackReference: input.rollbackReference ? clean(input.rollbackReference, 240) : null,
  });
}

export function persistEvolutionLearningRecord(
  repository: EvolutionLearningMemoryRepository,
  record: EvolutionLearningRecord,
): void {
  try {
    repository.append(createEvolutionLearningRecord(record));
  } catch {
    // Do not report a successful evolution cycle when its evidence could not
    // be persisted. The caller receives a stable fail-closed error only.
    throw new Error("EVOLVE_LEARNING_PERSISTENCE_FAILED");
  }
}
