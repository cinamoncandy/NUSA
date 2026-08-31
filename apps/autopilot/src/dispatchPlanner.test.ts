import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseGithubWebhookPayload, planGithubWebhookDispatch } from "./dispatchPlanner";

describe("NUSA autopilot dispatch planner", () => {
  it("plans main pushes without granting mutation authority", () => {
    const plan = planGithubWebhookDispatch("push", {
      ref: "refs/heads/main",
      after: "a".repeat(40),
      repository: { full_name: "cinamoncandy/NUSA" },
    });
    assert.equal(plan.kind, "MAIN_PUSH");
    assert.equal(plan.headSha, "a".repeat(40));
    assert.equal(plan.mutationAllowed, false);
  });

  it("ignores non-main pushes", () => {
    const plan = planGithubWebhookDispatch("push", { ref: "refs/heads/feature", after: "a".repeat(40) });
    assert.equal(plan.kind, "IGNORED");
    assert.equal(plan.reason, "non-main-push");
  });

  it("normalizes supported pull request changes", () => {
    const plan = planGithubWebhookDispatch("pull_request", {
      action: "synchronize",
      number: 12,
      pull_request: { head: { sha: "b".repeat(40) } },
      repository: { full_name: "cinamoncandy/NUSA" },
    });
    assert.deepEqual({ kind: plan.kind, prNumber: plan.prNumber, headSha: plan.headSha }, {
      kind: "PR_CHANGED",
      prNumber: 12,
      headSha: "b".repeat(40),
    });
  });

  it("preserves canonical main CI success as the coding-cycle edge", () => {
    const success = planGithubWebhookDispatch("workflow_run", {
      action: "completed",
      workflow_run: {
        id: 7,
        name: "CI",
        head_sha: "c".repeat(40),
        head_branch: "main",
        status: "completed",
        conclusion: "success",
        event: "push",
      },
      repository: { full_name: "cinamoncandy/NUSA" },
    });
    assert.equal(success.kind, "CI_SUCCEEDED");
    assert.equal(success.prNumber, null);
  });

  it("routes exact PR CI success to an audit request identity", () => {
    const plan = planGithubWebhookDispatch("workflow_run", {
      action: "completed",
      workflow_run: {
        id: 70,
        name: "CI",
        head_sha: "7".repeat(40),
        head_branch: "feature/pr-audit",
        status: "completed",
        conclusion: "success",
        event: "pull_request",
        pull_requests: [{ number: 42 }],
      },
      repository: { full_name: "cinamoncandy/NUSA" },
    });
    assert.equal(plan.kind, "PR_CI_SUCCEEDED");
    assert.equal(plan.prNumber, 42);
    assert.equal(plan.workflowRunId, 70);
    assert.equal(plan.headSha, "7".repeat(40));
    assert.equal(plan.mutationAllowed, false);
  });

  it("fails closed when successful PR CI lacks an unambiguous PR identity", () => {
    const plan = planGithubWebhookDispatch("workflow_run", {
      action: "completed",
      workflow_run: {
        id: 71,
        name: "CI",
        head_sha: "8".repeat(40),
        head_branch: "feature/pr-audit",
        status: "completed",
        conclusion: "success",
        event: "pull_request",
        pull_requests: [],
      },
      repository: { full_name: "cinamoncandy/NUSA" },
    });
    assert.equal(plan.kind, "IGNORED");
    assert.equal(plan.reason, "pr-ci-success-missing-pr-identity");
  });

  it("distinguishes workflow failure", () => {
    const failure = planGithubWebhookDispatch("workflow_run", {
      action: "completed",
      workflow_run: { id: 8, name: "CI", head_sha: "d".repeat(40), status: "completed", conclusion: "failure" },
    });
    assert.equal(failure.kind, "CI_FAILED");
  });

  it("does not advance the development loop for successful auxiliary workflows", () => {
    const plan = planGithubWebhookDispatch("workflow_run", {
      action: "completed",
      workflow_run: {
        id: 12,
        name: "Actual PAPER Public-Market Runtime Evidence",
        head_sha: "2".repeat(40),
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

  it("does not redispatch completion of a repository_dispatch consumer workflow", () => {
    const plan = planGithubWebhookDispatch("workflow_run", {
      action: "completed",
      workflow_run: {
        id: 11,
        head_sha: "1".repeat(40),
        status: "completed",
        conclusion: "success",
        event: "repository_dispatch",
        name: "Autopilot Execution Consumer",
      },
      repository: { full_name: "cinamoncandy/NUSA" },
    });
    assert.equal(plan.kind, "IGNORED");
    assert.equal(plan.reason, "workflow-run-originated-from-repository-dispatch");
    assert.equal(plan.mutationAllowed, false);
  });

  it("does not turn incomplete or neutral workflow states into success", () => {
    const incomplete = planGithubWebhookDispatch("workflow_run", {
      action: "requested",
      workflow_run: { id: 9, name: "CI", head_sha: "e".repeat(40), status: "queued", conclusion: null },
    });
    assert.equal(incomplete.kind, "IGNORED");

    const neutral = planGithubWebhookDispatch("workflow_run", {
      action: "completed",
      workflow_run: { id: 10, name: "CI", head_sha: "f".repeat(40), status: "completed", conclusion: "skipped" },
    });
    assert.equal(neutral.kind, "IGNORED");
  });

  it("fails closed on malformed JSON", () => {
    assert.throws(() => parseGithubWebhookPayload("{"), /GITHUB_WEBHOOK_JSON_INVALID/);
    assert.throws(() => parseGithubWebhookPayload("[]"), /GITHUB_WEBHOOK_PAYLOAD_INVALID/);
  });
});
