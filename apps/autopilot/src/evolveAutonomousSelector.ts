import type { EvolutionCircuitBreakerState } from "./evolveCircuitBreaker";
import type { EvolutionOpportunity } from "./evolveOpportunity";
import { rankEvolutionOpportunities, type EvolutionPriority } from "./evolveRanking";
import { decideEvolutionSchedule, type EvolutionSchedulePolicy } from "./evolveScheduler";

export interface EvolutionAutonomousSelectionInput {
  readonly opportunities: readonly EvolutionOpportunity[];
  readonly circuit: EvolutionCircuitBreakerState;
  readonly schedulePolicy: EvolutionSchedulePolicy;
  readonly activeExecutions: number;
  readonly elapsedSecondsSinceLastRun: number;
}

export interface EvolutionAutonomousSelection {
  readonly selectedOpportunity: EvolutionOpportunity | null;
  readonly priority: EvolutionPriority | null;
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
 * Selects at most one bounded EVOLVE candidate for the existing lifecycle.
 * This is selection only. It does not execute work, create queues, grant
 * promotion/deployment authority, or mutate production state.
 */
export function selectNextEvolutionOpportunity(
  input: EvolutionAutonomousSelectionInput,
): EvolutionAutonomousSelection {
  if (input.circuit.state !== "CLOSED") {
    return Object.freeze({ selectedOpportunity: null, priority: null, reason: "circuit-open", authority: AUTHORITY });
  }

  const schedule = decideEvolutionSchedule(
    input.schedulePolicy,
    input.activeExecutions,
    input.elapsedSecondsSinceLastRun,
  );
  if (!schedule.allowed) {
    return Object.freeze({ selectedOpportunity: null, priority: null, reason: schedule.reason, authority: AUTHORITY });
  }

  const ranked = rankEvolutionOpportunities(input.opportunities);
  const priority = ranked.find((candidate) => candidate.eligible && candidate.score > 0) ?? null;
  if (!priority) {
    return Object.freeze({ selectedOpportunity: null, priority: null, reason: "no-eligible-opportunity", authority: AUTHORITY });
  }

  const selectedOpportunity = input.opportunities.find((candidate) => candidate.id === priority.opportunityId) ?? null;
  if (!selectedOpportunity) {
    return Object.freeze({ selectedOpportunity: null, priority: null, reason: "ranked-opportunity-missing", authority: AUTHORITY });
  }

  return Object.freeze({
    selectedOpportunity,
    priority,
    reason: "bounded-autonomous-selection",
    authority: AUTHORITY,
  });
}
