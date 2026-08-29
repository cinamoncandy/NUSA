import {
  deriveWorkflowFailureOpportunities,
  type WorkflowOpportunitySourceInput,
} from "./evolveEvidenceOpportunitySource";
import {
  coordinateLevel7Evolution,
  type EvolutionLevel7Input,
  type EvolutionLevel7Result,
} from "./evolveLevel7";

export interface ScheduledEvolutionBridgeInput {
  readonly evidence: WorkflowOpportunitySourceInput;
  readonly level7: Omit<EvolutionLevel7Input, "opportunities">;
}

export interface ScheduledEvolutionBridgeResult {
  readonly discovered: number;
  readonly level7: EvolutionLevel7Result;
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
 * Thin composition edge from scheduled, evidence-backed workflow observations
 * into the existing Level 7 coordinator. It creates no executor, queue,
 * scheduler, lifecycle, promotion authority, deployment authority, or
 * production mutation capability.
 */
export function coordinateScheduledEvolution(
  input: ScheduledEvolutionBridgeInput,
): ScheduledEvolutionBridgeResult {
  const opportunities = deriveWorkflowFailureOpportunities(input.evidence);
  const level7 = coordinateLevel7Evolution({
    ...input.level7,
    opportunities,
  });

  return Object.freeze({
    discovered: opportunities.length,
    level7,
    authority: AUTHORITY,
  });
}
