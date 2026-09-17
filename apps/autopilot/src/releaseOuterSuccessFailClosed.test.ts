import assert from "node:assert/strict";
import { test } from "node:test";
import { planGithubWebhookDispatch } from "./dispatchPlanner";

test("#720-style outer Audit/Release success never becomes CI or Release success in Autopilot", () => {
  const plan = planGithubWebhookDispatch("workflow_run", {
    action: "completed",
    workflow_run: {
      id: 720,
      name: "Autopilot Deterministic Audit Release",
      head_sha: "0a1d6474" + "0".repeat(32),
      head_branch: "main",
      status: "completed",
      conclusion: "success",
      event: "repository_dispatch",
      pull_requests: [{ number: 1875 }],
    },
    repository: { full_name: "cinamoncandy/NUSA" },
  });

  assert.equal(plan.kind, "IGNORED");
  assert.equal(plan.reason, "workflow-run-originated-from-repository-dispatch");
  assert.equal(plan.mutationAllowed, false);
});

test("successful non-CI outer workflow is ignored even when it is not repository_dispatch", () => {
  const plan = planGithubWebhookDispatch("workflow_run", {
    action: "completed",
    workflow_run: {
      id: 721,
      name: "Autopilot Deterministic Audit Release",
      head_sha: "1".repeat(40),
      head_branch: "main",
      status: "completed",
      conclusion: "success",
      event: "push",
    },
    repository: { full_name: "cinamoncandy/NUSA" },
  });

  assert.equal(plan.kind, "IGNORED");
  assert.equal(plan.reason, "workflow-run-success-not-canonical-ci");
  assert.equal(plan.mutationAllowed, false);
});
