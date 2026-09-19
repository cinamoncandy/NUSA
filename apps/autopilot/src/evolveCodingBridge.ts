import { isFailureRepairReason, validateCodingRunnerRequest, type CodingRunnerRequest } from "./codingRunner";
import { selectNextEvolutionOpportunity, type EvolutionAutonomousSelectionInput } from "./evolveAutonomousSelector";
import { discoverEvolutionOpportunities, type EvolutionDiscoverySignal } from "./evolveOpportunityDiscovery";

export interface EvolutionCodingBridgeInput extends Omit<EvolutionAutonomousSelectionInput, "opportunities"> {
  readonly signals: readonly EvolutionDiscoverySignal[];
  readonly now: Date;
  readonly repository: string;
  readonly headSha: string;
  /** Provenance for failure-repair work: the failed run being repaired. */
  readonly workflowRunId: number;
  /**
   * Provenance for every other kind of work: the successful canonical CI run for the exact head.
   * Non-repair work must cite a successful run, so when none exists this bridge abstains rather
   * than citing an unrelated failed run that the verifier would reject.
   */
  readonly successWorkflowRunId?: number | null;
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

  const reason = `evolve:${selection.selectedOpportunity.id}:${selection.selectedOpportunity.problem}`;
  // The selected opportunity decides which run is this work's provenance -- not the caller. A
  // failure-repair cites the failed run; anything else cites the exact head's successful canonical
  // CI run. Binding the run id before the opportunity was chosen is what let issue-driven work
  // inherit a failed run and fail closed as CODING_RUNNER_WORKFLOW_NOT_SUCCESSFUL.
  const failureRepair = isFailureRepairReason(reason);
  const workflowRunId = failureRepair ? input.workflowRunId : (input.successWorkflowRunId ?? null);
  if (workflowRunId === null) {
    return Object.freeze({
      status: "ABSTAINED",
      reason: "exact-head-successful-ci-required-for-non-repair-work",
      rejectedSignalIds: discovery.rejectedSignalIds,
      request: null,
      authority: AUTHORITY,
    });
  }

  const request = validateCodingRunnerRequest({
    kind: "REPOSITORY_AUTOPILOT",
    repository: input.repository,
    headSha: input.headSha,
    workflowRunId,
    reason,
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
