import test from "node:test";
import assert from "node:assert/strict";
import { planAutopilotExecution } from "./executionPlanner";
import { planGithubWebhookDispatch } from "./dispatchPlanner";
import type { AutopilotDispatchPlan } from "./dispatchPlanner";

const HEAD = "fb340e737c5a09978b140bb0b48bcaa78587de7d";

const prCiSuccess = (workflowRunAttempt: number | null): AutopilotDispatchPlan => Object.freeze({
  kind: "PR_CI_SUCCEEDED",
  repository: "cinamoncandy/NUSA",
  headSha: HEAD,
  prNumber: 1843,
  workflowRunId: 35327752994,
  workflowRunAttempt,
  reason: "pull-request-ci-success",
  mutationAllowed: false,
});

test("a CI re-run of the same run id is a distinct Audit execution identity", () => {
  const first = planAutopilotExecution(prCiSuccess(1));
  const retry = planAutopilotExecution(prCiSuccess(2));
  assert.equal(first.kind, "AUDIT_REQUEST");
  assert.equal(retry.kind, "AUDIT_REQUEST");
  // Without the attempt in the identity these collide and the retry is suppressed as a duplicate,
  // permanently starving a head whose first Audit attempt reached no verdict.
  assert.notEqual(first.dedupeKey, retry.dedupeKey);
  assert.notEqual(first.executionId, retry.executionId);
});

test("the same attempt of the same run stays one Audit execution identity", () => {
  assert.equal(planAutopilotExecution(prCiSuccess(2)).dedupeKey, planAutopilotExecution(prCiSuccess(2)).dedupeKey);
});

test("an absent run attempt is treated as the first attempt", () => {
  assert.equal(planAutopilotExecution(prCiSuccess(null)).dedupeKey, planAutopilotExecution(prCiSuccess(1)).dedupeKey);
});

test("the dispatch planner carries the CI run attempt from the workflow_run payload", () => {
  const payload = {
    action: "completed",
    repository: { full_name: "cinamoncandy/NUSA" },
    workflow_run: {
      id: 35327752994,
      run_attempt: 2,
      name: "CI",
      event: "pull_request",
      status: "completed",
      conclusion: "success",
      head_sha: HEAD,
      pull_requests: [{ number: 1843, head: { sha: HEAD } }],
    },
  };
  const plan = planGithubWebhookDispatch("workflow_run", payload);
  assert.equal(plan.kind, "PR_CI_SUCCEEDED");
  assert.equal(plan.workflowRunAttempt, 2);
  assert.equal(planAutopilotExecution(plan).dedupeKey, `audit:1843:35327752994:2:${HEAD}`);
});
