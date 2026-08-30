import test from "node:test";
import assert from "node:assert/strict";
import { runScheduledAutopilot } from "./scheduledRuntime";
import type { ExecutionCoordinatorNamespace } from "./executionCoordinator";

const SHA = "c".repeat(40);
const FAILURE_RUN_ID = 5151;
const NOW = 1_787_968_000_000;

function namespace(): ExecutionCoordinatorNamespace {
  return {
    idFromName: (name: string) => ({ name }),
    get: () => ({
      async fetch(input: RequestInfo | URL) {
        const url = String(input);
        if (url.endsWith("/scheduled-receipt")) return new Response("not found", { status: 404 });
        if (url.endsWith("/acquire")) {
          return new Response(JSON.stringify({ acquired: true }), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.endsWith("/dispatched")) {
          return new Response(JSON.stringify({ updated: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("not found", { status: 404 });
      },
    }),
  };
}

test("scheduled runtime routes a fresh current-main CI failure into the coding consumer before requiring successful canonical CI", async () => {
  const dispatchPayloads: Record<string, unknown>[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/branches/main")) {
      return new Response(JSON.stringify({ commit: { sha: SHA } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/actions/runs?")) {
      return new Response(JSON.stringify({ workflow_runs: [{
        id: FAILURE_RUN_ID,
        name: "CI",
        conclusion: "failure",
        head_branch: "main",
        head_sha: SHA,
        event: "push",
        completed_at: new Date(NOW - 30_000).toISOString(),
      }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/dispatches")) {
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body)) as { client_payload?: unknown };
      assert.ok(body.client_payload && typeof body.client_payload === "object" && !Array.isArray(body.client_payload));
      dispatchPayloads.push(body.client_payload as Record<string, unknown>);
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const outcome = await runScheduledAutopilot({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_GITHUB_REPOSITORY: "cinamoncandy/NUSA",
    NUSA_EXECUTION_COORDINATOR: namespace(),
  }, NOW, fetchImpl);

  assert.equal(outcome.status, "EXECUTION_DISPATCHED");
  assert.equal(outcome.reason, "github-coding-dispatch-accepted");
  assert.equal(outcome.headSha, SHA);
  assert.equal(outcome.workflowRunId, FAILURE_RUN_ID);
  assert.deepEqual(outcome.discoveredOpportunityIds, [`gha:ci:${SHA}:failure`]);
  assert.equal(dispatchPayloads.length, 1);
  const dispatchPayload = dispatchPayloads[0];
  assert.ok(dispatchPayload);
  assert.equal(dispatchPayload.head_sha, SHA);
  assert.equal(dispatchPayload.workflow_run_id, FAILURE_RUN_ID);
  assert.match(String(dispatchPayload.reason), new RegExp(`gha:ci:${SHA}:failure`));
  assert.equal(dispatchPayload.live_authority, "NONE");
  assert.equal(dispatchPayload.production_mutation_allowed, false);
  assert.equal(dispatchPayload.ai_authority, "ZERO_AUTHORITY");
});
