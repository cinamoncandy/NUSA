import type { AutopilotDispatchPlan } from "./dispatchPlanner";
import type { AutopilotExecutionRequest } from "./executionPlanner";
import {
  acquireExecutionLease,
  createExecutionState,
  transitionExecution,
  type AutonomousExecutionState,
} from "./autonomousExecutionState";
import {
  toCodingRunnerRequest,
  validateCodingExecutionEnvelope,
  type CodingExecutionEnvelope,
  type ExecutionOrigin,
} from "./codingExecutionEnvelope";

export interface PreparedProductionExecution {
  readonly state: AutonomousExecutionState;
  readonly envelope: CodingExecutionEnvelope;
  readonly request: AutopilotExecutionRequest;
}

export interface ProductionExecutionOptions {
  readonly deliveryId: string;
  readonly origin: ExecutionOrigin;
  readonly now: number;
  readonly leaseTtlMs?: number;
  readonly allowedRepository: string;
}

const SHA40 = /^[0-9a-f]{40}$/i;
const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000;

const boundedId = (value: string): string => value.trim().replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 160);

export function prepareProductionExecution(
  dispatch: AutopilotDispatchPlan,
  options: ProductionExecutionOptions,
): PreparedProductionExecution | null {
  // Only a completed, successful canonical CI run has the exact evidence needed to enter
  // autonomous coding. Push/PR events remain planning signals and cannot bypass this gate.
  if (dispatch.kind !== "CI_SUCCEEDED") return null;
  if (dispatch.repository !== options.allowedRepository) throw new Error("PRODUCTION_EXECUTION_REPOSITORY_INVALID");
  if (!dispatch.headSha || !SHA40.test(dispatch.headSha)) throw new Error("PRODUCTION_EXECUTION_HEAD_SHA_INVALID");
  if (!Number.isSafeInteger(dispatch.workflowRunId) || (dispatch.workflowRunId ?? 0) <= 0) {
    throw new Error("PRODUCTION_EXECUTION_WORKFLOW_RUN_REQUIRED");
  }
  if (!options.deliveryId.trim()) throw new Error("PRODUCTION_EXECUTION_DELIVERY_ID_REQUIRED");
  if (!Number.isFinite(options.now)) throw new Error("PRODUCTION_EXECUTION_TIME_INVALID");

  const delivery = boundedId(options.deliveryId);
  const cycleId = `ci:${dispatch.workflowRunId}`;
  const workItemId = `continue:${dispatch.headSha}`;
  const executionId = `github:${delivery}`;
  const dedupeKey = `ci:${dispatch.workflowRunId}:${dispatch.headSha}`;

  let state = createExecutionState({ cycleId, workItemId, executionId, dedupeKey });
  state = acquireExecutionLease(state, "cloudflare:nusa-autopilot", options.now, options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS);

  const envelope = validateCodingExecutionEnvelope({
    cycleId,
    workItemId,
    executionId,
    dedupeKey,
    origin: options.origin,
    repository: dispatch.repository,
    baseSha: dispatch.headSha,
    workflowRunId: dispatch.workflowRunId,
    objective: "Continue the highest-value safe NUSA engineering improvement from verified main evidence.",
    acceptanceCriteria: [
      "Preserve exact-head CI verification before merge.",
      "Preserve liveAuthority=NONE, productionMutationAllowed=false, and AI authority=ZERO_AUTHORITY.",
      "Produce auditable GitHub evidence for any repository change.",
    ],
    evidenceRefs: [`github:workflow-run:${dispatch.workflowRunId}`, `github:commit:${dispatch.headSha}`],
    allowedScope: ["apps/autopilot/", ".github/workflows/", "scripts/"],
    forbiddenScope: ["live-trading", "production-authority", "secrets"],
    maxChangedFiles: 12,
    mutationAllowed: false,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  }, options.allowedRepository);

  state = transitionExecution(state, "CODEX_DISPATCHED");
  const runner = toCodingRunnerRequest(envelope);
  const request: AutopilotExecutionRequest = Object.freeze({
    kind: runner.kind,
    repository: runner.repository,
    headSha: runner.headSha,
    workflowRunId: runner.workflowRunId,
    reason: runner.reason,
    mutationAllowed: false,
  });
  return Object.freeze({ state, envelope, request });
}
