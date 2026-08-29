import test from "node:test";
import assert from "node:assert/strict";
import { runScheduledAutopilot } from "./scheduledRuntime";
import type { ExecutionCoordinatorNamespace, ScheduledRuntimeReceipt } from "./executionCoordinator";

const SHA = "a".repeat(40);
const RUN_ID = 4242;
const NOW = 1_787_968_000_000;

function namespace(receipt: ScheduledRuntimeReceipt): ExecutionCoordinatorNamespace {
  return {
    idFromName: (name: string) => ({ name }),
    get: () => ({
      async fetch(input: RequestInfo | URL) {
        const url = String(input);
        if (url.endsWith("/scheduled-receipt")) {
          return new Response(JSON.stringify({ receipt }), { status: 200, headers: { "content-type": "application/json" } });
        }
        throw new Error(`unexpected coordinator call: ${url}`);
      },
    }),
  };
}

function githubFetch(withFreshFailure = false): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/branches/main")) {
      return new Response(JSON.stringify({ commit: { sha: SHA } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/actions/runs?")) {
      const workflowRuns: unknown[] = [{ id: RUN_ID, name: "CI", conclusion: "success", head_branch: "main", head_sha: SHA, event: "push" }];
      if (withFreshFailure) workflowRuns.push({ id: RUN_ID + 1, name: "CI", conclusion: "failure", head_branch: "main", head_sha: "b".repeat(40), event: "push", completed_at: new Date(NOW + 1_000).toISOString() });
      return new Response(JSON.stringify({ workflow_runs: workflowRuns }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected github call: ${url}`);
  }) as typeof fetch;
}

const receipt: ScheduledRuntimeReceipt = {
  scheduledTime: NOW - 60_000,
  observedAt: NOW - 30_000,
  status: "EXECUTION_DISPATCHED",
  reason: "github-executor-dispatched",
  headSha: SHA,
  workflowRunId: RUN_ID,
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
};

test("unchanged scheduled state exits before dispatch and coding work", async () => {
  const outcome = await runScheduledAutopilot({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_EXECUTION_COORDINATOR: namespace(receipt),
  }, NOW, githubFetch());
  assert.equal(outcome.status, "DUPLICATE_EXECUTION_SUPPRESSED");
  assert.equal(outcome.reason, "scheduled-state-unchanged");
  assert.equal(outcome.headSha, SHA);
  assert.equal(outcome.workflowRunId, RUN_ID);
});

test("fresh main workflow failure bypasses unchanged-state gate", async () => {
  const outcome = await runScheduledAutopilot({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_EXECUTION_COORDINATOR: namespace(receipt),
  }, NOW + 2_000, githubFetch(true));
  assert.notEqual(outcome.reason, "scheduled-state-unchanged");
});
