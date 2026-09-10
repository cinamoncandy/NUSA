import test from "node:test";
import assert from "node:assert/strict";
import { runScheduledAutopilot } from "./scheduledRuntime";
import type { ExecutionCoordinatorNamespace } from "./executionCoordinator";

const SHA = "a".repeat(40);
const RUN_ID = 9401;
const NOW = Date.parse("2026-09-10T06:30:00.000Z");

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

const safeBacklogIssue = {
  number: 903,
  title: "P1: Autonomous Development Control Plane for maximum verified merge throughput",
  body: "Autopilot control-plane work in apps/autopilot/src. Safety invariants: liveAuthority=NONE, productionMutationAllowed=false, aiAuthority=ZERO_AUTHORITY. No LIVE activation or real broker mutation.",
  state: "open",
  author_association: "OWNER",
  updated_at: new Date(NOW - 30_000).toISOString(),
};

function githubFetch(options: { staleCurrentMainFailure?: boolean } = {}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/branches/main")) {
      return new Response(JSON.stringify({ commit: { sha: SHA } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/actions/runs?")) {
      const workflow_runs: Record<string, unknown>[] = [{
        id: RUN_ID,
        name: "CI",
        conclusion: "success",
        head_branch: "main",
        head_sha: SHA,
        event: "push",
        completed_at: new Date(NOW - 60_000).toISOString(),
      }];
      if (options.staleCurrentMainFailure) {
        workflow_runs.push({
          id: RUN_ID - 1,
          name: "CI",
          conclusion: "failure",
          head_branch: "main",
          head_sha: SHA,
          event: "push",
          completed_at: new Date(NOW - 2 * 60 * 60 * 1000).toISOString(),
        });
      }
      return new Response(JSON.stringify({ workflow_runs }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/issues?state=open")) {
      return new Response(JSON.stringify([safeBacklogIssue]), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/dispatches")) {
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.event_type, "nusa_autopilot_execution");
      assert.equal(body.client_payload.kind, "REPOSITORY_AUTOPILOT");
      assert.match(body.client_payload.reason, /GitHub issue #903/);
      assert.equal(body.client_payload.head_sha, SHA);
      assert.equal(body.client_payload.live_authority, "NONE");
      assert.equal(body.client_payload.production_mutation_allowed, false);
      assert.equal(body.client_payload.ai_authority, "ZERO_AUTHORITY");
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

test("healthy exact-main CI dispatches a bounded safe backlog task instead of reporting zero work", async () => {
  const outcome = await runScheduledAutopilot({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_GITHUB_REPOSITORY: "cinamoncandy/NUSA",
    NUSA_EXECUTION_COORDINATOR: namespace(),
  }, NOW, githubFetch());

  assert.equal(outcome.status, "EXECUTION_DISPATCHED");
  assert.equal(outcome.reason, "github-coding-dispatch-accepted");
  assert.equal(outcome.headSha, SHA);
  assert.equal(outcome.workflowRunId, RUN_ID);
  assert.ok(outcome.discoveredOpportunityIds.includes("github-issue-903"));
  assert.equal(outcome.liveAuthority, "NONE");
  assert.equal(outcome.productionMutationAllowed, false);
  assert.equal(outcome.aiAuthority, "ZERO_AUTHORITY");
});

test("two-hour-old current-main failure cannot shadow a fresh safe backlog task", async () => {
  const outcome = await runScheduledAutopilot({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_GITHUB_REPOSITORY: "cinamoncandy/NUSA",
    NUSA_EXECUTION_COORDINATOR: namespace(),
  }, NOW, githubFetch({ staleCurrentMainFailure: true }));

  assert.equal(outcome.status, "EXECUTION_DISPATCHED");
  assert.equal(outcome.reason, "github-coding-dispatch-accepted");
  assert.ok(outcome.discoveredOpportunityIds.includes("github-issue-903"));
});
