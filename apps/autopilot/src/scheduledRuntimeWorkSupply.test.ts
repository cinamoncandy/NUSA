import test from "node:test";
import assert from "node:assert/strict";
import { runScheduledAutopilot } from "./scheduledRuntime";
import type { ExecutionCoordinatorNamespace } from "./executionCoordinator";

const SHA = "a".repeat(40);
const RUN_ID = 4242;
const NOW = 1_787_968_000_000;

function namespace(): ExecutionCoordinatorNamespace {
  return {
    idFromName: (name: string) => ({ name }),
    get: () => ({
      async fetch(input: RequestInfo | URL) {
        const url = String(input);
        if (url.endsWith("/scheduled-receipt")) {
          return new Response(JSON.stringify({ receipt: null }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (url.endsWith("/acquire")) {
          return new Response(JSON.stringify({ acquired: true }), { status: 201, headers: { "content-type": "application/json" } });
        }
        if (url.endsWith("/dispatched")) {
          return new Response(JSON.stringify({ updated: true }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response("not found", { status: 404 });
      },
    }),
  };
}

function githubFetch(issueCount: number | null): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/search/issues?")) {
      if (issueCount === null) return new Response("unavailable", { status: 503 });
      return new Response(JSON.stringify({ total_count: issueCount, items: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/branches/main")) {
      return new Response(JSON.stringify({ commit: { sha: SHA } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/actions/runs?")) {
      return new Response(JSON.stringify({ workflow_runs: [{ id: RUN_ID, name: "CI", conclusion: "success", head_branch: "main", head_sha: SHA, event: "push" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/dispatches")) return new Response(null, { status: 204 });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

test("scheduled runtime reports raw issue backlog separately from failure opportunities", async () => {
  const outcome = await runScheduledAutopilot({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_EXECUTION_COORDINATOR: namespace(),
  }, NOW, githubFetch(60));

  assert.equal(outcome.workSupply.status, "OBSERVED");
  assert.equal(outcome.workSupply.rawOpenIssueCount, 60);
  assert.equal(outcome.workSupply.readyWorkCount, null);
  assert.equal(outcome.workSupply.readyWorkStatus, "UNKNOWN");
  assert.equal(outcome.workflowFailureOpportunityCount, 0);
  assert.deepEqual(outcome.discoveredOpportunityIds, []);
});

test("scheduled runtime reports GitHub supply failure as UNKNOWN, never fake zero", async () => {
  const outcome = await runScheduledAutopilot({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_EXECUTION_COORDINATOR: namespace(),
  }, NOW, githubFetch(null));

  assert.equal(outcome.workSupply.status, "UNKNOWN");
  assert.equal(outcome.workSupply.rawOpenIssueCount, null);
  assert.equal(outcome.workSupply.readyWorkCount, null);
  assert.equal(outcome.workSupply.reason, "GITHUB_HTTP_503");
});
