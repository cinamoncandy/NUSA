import assert from "node:assert/strict";
import test from "node:test";
import { planAutopilotExecution } from "./executionPlanner";

test("CI_FAILED becomes bounded repository autopilot repair evidence", () => {
  const headSha = "1777b2d4f7cf9fa4402d8b8b00c51175195e8568";
  const workflowRunId = 33298118859;
  const result = planAutopilotExecution({
    kind: "CI_FAILED",
    repository: "cinamoncandy/NUSA",
    headSha,
    prNumber: null,
    workflowRunId,
    reason: "workflow-run:failure",
    mutationAllowed: false,
  });

  assert.equal(result.kind, "REPOSITORY_AUTOPILOT");
  assert.equal(result.repository, "cinamoncandy/NUSA");
  assert.equal(result.headSha, headSha);
  assert.equal(result.workflowRunId, workflowRunId);
  assert.equal(result.reason, `gha:${workflowRunId}:${headSha}:failure`);
  assert.equal(result.executionId, `ci-failure:${workflowRunId}`);
  assert.equal(result.dedupeKey, `ci-failure:${workflowRunId}:${headSha}`);
  assert.equal(result.mutationAllowed, false);
});

test("CI_FAILED without exact bounded identity fails closed", () => {
  const result = planAutopilotExecution({
    kind: "CI_FAILED",
    repository: "cinamoncandy/NUSA",
    headSha: null,
    prNumber: null,
    workflowRunId: 33298118859,
    reason: "workflow-run:failure",
    mutationAllowed: false,
  });

  assert.equal(result.kind, "NOOP");
  assert.equal(result.reason, "ci-failure-missing-bounded-identity");
  assert.equal(result.mutationAllowed, false);
});
