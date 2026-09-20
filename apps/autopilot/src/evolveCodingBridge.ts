import { validateCodingRunnerRequest, type CodingRunnerRequest } from "./codingRunner";
import { selectNonConflictingEvolutionOpportunities, type EvolutionAutonomousSelectionInput } from "./evolveAutonomousSelector";
import { discoverEvolutionOpportunities, type EvolutionDiscoverySignal } from "./evolveOpportunityDiscovery";

export interface EvolutionCodingBridgeInput extends Omit<EvolutionAutonomousSelectionInput, "opportunities"> {
  readonly activeConflictKeys?: readonly string[];
  readonly signals: readonly EvolutionDiscoverySignal[];
  readonly now: Date;
  readonly repository: string;
  readonly headSha: string;
  readonly workflowRunId: number;
}

export interface EvolutionCodingBridgeResult {
  readonly status: "ABSTAINED" | "READY";
  readonly reason: string;
  readonly rejectedSignalIds: readonly string[];
  readonly request: CodingRunnerRequest | null;
  readonly selectedOpportunityId: string | null;
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
 * Bounded bridge from read-only EVOLVE discovery evidence into the existing
 * autonomous selector and CodingRunner request contract.
 *
 * This function does not execute, enqueue, promote, deploy, or mutate
 * production. GitHub exact-head/workflow verification remains the
 * responsibility of executeCodingRunner before any configured coding engine
 * receives the request.
 */
export function prepareDiscoveredCodingRequest(input: EvolutionCodingBridgeInput): EvolutionCodingBridgeResult {
  const discovery = discoverEvolutionOpportunities(input.signals, input.now);
  const boundedSelection = selectNonConflictingEvolutionOpportunities({
    opportunities: discovery.opportunities,
    circuit: input.circuit,
    schedulePolicy: input.schedulePolicy,
    activeExecutions: input.activeExecutions,
    activeConflictKeys: input.activeConflictKeys ?? [],
    elapsedSecondsSinceLastRun: input.elapsedSecondsSinceLastRun,
    maxSelections: 1,
  });
  const selectedOpportunity = boundedSelection.selectedOpportunities[0] ?? null;

  if (!selectedOpportunity) {
    return Object.freeze({
      status: "ABSTAINED",
      reason: boundedSelection.reason,
      rejectedSignalIds: discovery.rejectedSignalIds,
      request: null,
      selectedOpportunityId: null,
      authority: AUTHORITY,
    });
  }

  if (!selectedOpportunity.canonicalOwner || !selectedOpportunity.conflictKeys?.length) {
    return Object.freeze({
      status: "ABSTAINED",
      reason: "ownership-metadata-required",
      rejectedSignalIds: discovery.rejectedSignalIds,
      request: null,
      selectedOpportunityId: null,
      authority: AUTHORITY,
    });
  }

  const request = validateCodingRunnerRequest({
    kind: "REPOSITORY_AUTOPILOT",
    repository: input.repository,
    headSha: input.headSha,
    workflowRunId: input.workflowRunId,
    reason: `evolve:${selectedOpportunity.id}:${selectedOpportunity.problem}`,
    executionId: `evolve-coding:${input.headSha.slice(0, 16)}:${selectedOpportunity.id.replace(/[^A-Za-z0-9_.:-]+/g, "-").slice(0, 100)}`,
    dedupeKey: `evolve-coding:${input.headSha}:${selectedOpportunity.id.replace(/[^A-Za-z0-9_.:-]+/g, "-").slice(0, 180)}`,
    canonicalOwner: selectedOpportunity.canonicalOwner,
    conflictKeys: selectedOpportunity.conflictKeys,
    mutationAllowed: false,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  }, input.repository);

  return Object.freeze({
    status: "READY",
    reason: "discovery-selected-for-existing-coding-runner",
    rejectedSignalIds: discovery.rejectedSignalIds,
    request,
    selectedOpportunityId: selectedOpportunity.id,
    authority: AUTHORITY,
  });
}
