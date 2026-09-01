import assert from "node:assert/strict";
import test from "node:test";
import { executeGithubDispatch } from "./githubExecutor";

test("raw main and PR change signals remain observation-only without workflow identity", async () => {
  for (const [reason, prNumber] of [["continue-from:main_push", null], ["continue-from:pr_changed", 1408]] as const) {
    let fetchCalls = 0;
    const result = await executeGithubDispatch({
      kind: "REPOSITORY_AUTOPILOT",
      repository: "cinamoncandy/NUSA",
      headSha: "a".repeat(40),
      prNumber,
      workflowRunId: null,
      reason,
      mutationAllowed: false,
    }, {
      token: "fixture",
      allowedRepository: "cinamoncandy/NUSA",
    }, async () => {
      fetchCalls += 1;
      return new Response(null, { status: 204 });
    });

    assert.equal(result.status, "NOOP");
    assert.equal(result.reason, "github-executor-raw-event-observation-only");
    assert.equal(fetchCalls, 0);
  }
});

test("other repository execution requests still require bounded workflow identity", async () => {
  const result = await executeGithubDispatch({
    kind: "REPOSITORY_AUTOPILOT",
    repository: "cinamoncandy/NUSA",
    headSha: "b".repeat(40),
    prNumber: null,
    workflowRunId: null,
    reason: "unexpected-unbounded-execution",
    mutationAllowed: false,
  }, {
    token: "fixture",
    allowedRepository: "cinamoncandy/NUSA",
  });

  assert.equal(result.status, "REJECTED");
  assert.equal(result.reason, "github-executor-workflow-run-id-required");
});
