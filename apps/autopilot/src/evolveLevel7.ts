import {
  selectNextEvolutionOpportunity,
  type EvolutionAutonomousSelection,
} from "./evolveAutonomousSelector";
import {
  coordinateEvolutionLifecycle,
  type EvolutionLifecycleInput,
  type EvolutionLifecycleResult,
} from "./evolveLifecycle";
import { persistEvolutionLearningRecord, type EvolutionLearningMemoryRepository } from "./evolveLearningMemory";
import type { EvolutionOpportunity } from "./evolveOpportunity";

export interface EvolutionLevel7Input {
  readonly opportunities: readonly EvolutionOpportunity[];
  readonly lifecycle: Omit<EvolutionLifecycleInput, "opportunity">;
  /**
   * Durable evidence is part of the Level 7 composition contract. A selected
   * cycle must not be allowed to complete without an injected persistence
   * boundary; the coordinator never chooses or creates the underlying store.
   */
  readonly learningMemory: EvolutionLearningMemoryRepository;
}

export interface EvolutionLevel7Result {
  readonly status: "NO_SELECTION" | "COORDINATED";
  readonly selection: EvolutionAutonomousSelection;
  readonly lifecycle: EvolutionLifecycleResult | null;
  readonly reason: string;
  readonly authority: {
    readonly liveAuthority: "NONE";
    readonly productionMutationAllowed: false;
    readonly aiAuthority: "ZERO_AUTHORITY";
  };
}

const AUTHORITY = Object.freeze({
  liveAuthority: "NONE" as const,
  productionMutationAllowed: false as const,
  aiAuthority: "ZERO_AUTHORITY" as const,
});

/**
 * Thin Level 7 composition boundary.
 *
 * It reuses the autonomous selector and the existing lifecycle coordinator.
 * It does not add an executor, queue, lease, dedupe system, promotion authority,
 * deployment authority, or production mutation capability.
 */
export function coordinateLevel7Evolution(input: EvolutionLevel7Input): EvolutionLevel7Result {
  const selection = selectNextEvolutionOpportunity({
    opportunities: input.opportunities,
    circuit: input.lifecycle.circuit.state,
    schedulePolicy: input.lifecycle.schedule.policy,
    activeExecutions: input.lifecycle.schedule.activeExecutions,
    elapsedSecondsSinceLastRun: input.lifecycle.schedule.elapsedSecondsSinceLastRun,
  });

  if (!selection.selectedOpportunity) {
    return Object.freeze({
      status: "NO_SELECTION",
      selection,
      lifecycle: null,
      reason: selection.reason,
      authority: AUTHORITY,
    });
  }

  // Keep the runtime boundary fail-closed for JavaScript callers and stale
  // integrations that may not have been compiled against the required field.
  // No evolution lifecycle is coordinated until its evidence sink exists.
  if (
    input.learningMemory == null
    || typeof input.learningMemory.append !== "function"
    || typeof input.learningMemory.list !== "function"
  ) {
    throw new Error("EVOLVE_LEARNING_PERSISTENCE_UNAVAILABLE");
  }

  const lifecycle = coordinateEvolutionLifecycle({
    ...input.lifecycle,
    opportunity: selection.selectedOpportunity,
  });

  if (lifecycle.learning != null) {
    persistEvolutionLearningRecord(input.learningMemory, lifecycle.learning);
  }

  return Object.freeze({
    status: "COORDINATED",
    selection,
    lifecycle,
    reason: "bounded-level7-composition",
    authority: AUTHORITY,
  });
}
