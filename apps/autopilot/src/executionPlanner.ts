import type { AutopilotDispatchPlan } from "./dispatchPlanner";

export type ExecutionRequestKind = "NOOP" | "REPOSITORY_AUTOPILOT" | "CI_RECOVERY";

export interface AutopilotExecutionRequest {
  readonly kind: ExecutionRequestKind;
  readonly repository: string | null;
  readonly headSha: string | null;
  readonly workflowRunId: number | null;
  readonly reason: string;
  readonly mutationAllowed: false;
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

export function planAutopilotExecution(dispatch: AutopilotDispatchPlan): AutopilotExecutionRequest {
  if (dispatch.kind === "CI_FAILED") {
    return freeze({
      kind: "CI_RECOVERY",
      repository: dispatch.repository,
      headSha: dispatch.headSha,
      workflowRunId: dispatch.workflowRunId,
      reason: "classify-failure-before-any-retry",
      mutationAllowed: false,
    });
  }

  if (dispatch.kind === "MAIN_PUSH" || dispatch.kind === "CI_SUCCEEDED" || dispatch.kind === "PR_CHANGED") {
    return freeze({
      kind: "REPOSITORY_AUTOPILOT",
      repository: dispatch.repository,
      headSha: dispatch.headSha,
      workflowRunId: dispatch.workflowRunId,
      reason: `continue-from:${dispatch.kind.toLowerCase()}`,
      mutationAllowed: false,
    });
  }

  return freeze({
    kind: "NOOP",
    repository: dispatch.repository,
    headSha: dispatch.headSha,
    workflowRunId: dispatch.workflowRunId,
    reason: dispatch.reason,
    mutationAllowed: false,
  });
}
