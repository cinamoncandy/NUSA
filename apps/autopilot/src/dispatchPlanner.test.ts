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

  it("distinguishes completed workflow success and failure", () => {
    const success = planGithubWebhookDispatch("workflow_run", {
      action: "completed",
      workflow_run: { id: 7, head_sha: "c".repeat(40), status: "completed", conclusion: "success" },
    });
    assert.equal(success.kind, "CI_SUCCEEDED");

    const failure = planGithubWebhookDispatch("workflow_run", {
      action: "completed",
      workflow_run: { id: 8, head_sha: "d".repeat(40), status: "completed", conclusion: "failure" },
    });
    assert.equal(failure.kind, "CI_FAILED");
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
      workflow_run: { id: 9, head_sha: "e".repeat(40), status: "queued", conclusion: null },
    });
    assert.equal(incomplete.kind, "IGNORED");

    const neutral = planGithubWebhookDispatch("workflow_run", {
      action: "completed",
      workflow_run: { id: 10, head_sha: "f".repeat(40), status: "completed", conclusion: "skipped" },
    });
    assert.equal(neutral.kind, "IGNORED");
  });

  it("fails closed on malformed JSON", () => {
    assert.throws(() => parseGithubWebhookPayload("{"), /GITHUB_WEBHOOK_JSON_INVALID/);
    assert.throws(() => parseGithubWebhookPayload("[]"), /GITHUB_WEBHOOK_PAYLOAD_INVALID/);
  });
});
