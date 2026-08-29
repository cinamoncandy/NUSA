import { validateCodingRunnerRequest, type CodingRunnerRequest } from "./codingRunner";
import { selectNextEvolutionOpportunity, type EvolutionAutonomousSelectionInput } from "./evolveAutonomousSelector";
import { discoverEvolutionOpportunities, type EvolutionDiscoverySignal } from "./evolveOpportunityDiscovery";

export interface EvolutionCodingBridgeInput extends Omit<EvolutionAutonomousSelectionInput, "opportunities"> {
  readonly signals: readonly EvolutionDiscoverySignal[];
  readonly now: Date;
  readonly repository: string;
  readonly headSha: string;
  readonly workflowRunId: number;
  readonly executionId: string;
  readonly dedupeKey: string;
}

export interface EvolutionCodingBridgeResult {
  readonly status: "ABSTAINED" | "READY";
  readonly reason: string;
  readonly rejectedSignalIds: readonly string[];
  readonly request: CodingRunnerRequest | null;
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
  const selection = selectNextEvolutionOpportunity({
    opportunities: discovery.opportunities,
    circuit: input.circuit,
    schedulePolicy: input.schedulePolicy,
    activeExecutions: input.activeExecutions,
    elapsedSecondsSinceLastRun: input.elapsedSecondsSinceLastRun,
  });

  if (!selection.selectedOpportunity) {
    return Object.freeze({
      status: "ABSTAINED",
      reason: selection.reason,
      rejectedSignalIds: discovery.rejectedSignalIds,
      request: null,
      authority: AUTHORITY,
    });
  }

  const request = validateCodingRunnerRequest({
    kind: "REPOSITORY_AUTOPILOT",
    repository: input.repository,
    headSha: input.headSha,
    workflowRunId: input.workflowRunId,
    reason: `evolve:${selection.selectedOpportunity.id}:${selection.selectedOpportunity.problem}`,
    executionId: input.executionId,
    dedupeKey: input.dedupeKey,
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
    authority: AUTHORITY,
  });
}
