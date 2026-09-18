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

test("scheduled runtime does not route an exact-main deployment evidence wait into autonomous coding", async () => {
  let dispatched = false;
  const fetchImpl = (async (input: RequestInfo | URL) => {
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
        name: "Autopilot Cloudflare Credential Preflight",
        status: "completed",
        conclusion: "failure",
        head_branch: "main",
        head_sha: SHA,
        event: "push",
        updated_at: new Date(NOW - 30_000).toISOString(),
      }, {
        id: 5150,
        name: "CI",
        status: "completed",
        conclusion: "success",
        head_branch: "main",
        head_sha: SHA,
        event: "push",
        updated_at: new Date(NOW - 20_000).toISOString(),
      }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith(`/actions/runs/${FAILURE_RUN_ID}`)) {
      return new Response(JSON.stringify({
        path: ".github/workflows/autopilot-cloudflare-credential-preflight.yml",
        head_branch: "main",
        event: "push",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes(`/actions/runs/${FAILURE_RUN_ID}/jobs?`)) {
      return new Response(JSON.stringify({ jobs: [{ name: "preflight", steps: [
        { name: "Validate Cloudflare credential inputs", conclusion: "success" },
        { name: "Verify configured Cloudflare account is accessible", conclusion: "success" },
        { name: "Verify Wrangler account authentication", conclusion: "success" },
        { name: "Require successful exact-main Cloudflare deployment", conclusion: "failure" },
      ] }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/dispatches")) dispatched = true;
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const outcome = await runScheduledAutopilot({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_GITHUB_REPOSITORY: "cinamoncandy/NUSA",
    NUSA_EXECUTION_COORDINATOR: namespace(),
  }, NOW, fetchImpl);

  assert.equal(outcome.status, "ABSTAINED");
  assert.equal(outcome.reason, "workflow-not-code-actionable:EVIDENCE_MISSING");
  assert.equal(outcome.headSha, SHA);
  assert.equal(outcome.workflowRunId, FAILURE_RUN_ID);
  assert.deepEqual(outcome.discoveredOpportunityIds, [`gha:autopilot-cloudflare-credential-preflight:${SHA}:failure`]);
  assert.equal(dispatched, false);
});

test("updated_at fallback is fail-closed for runs that are not completed", async () => {
  let dispatched = false;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/branches/main")) return new Response(JSON.stringify({ commit: { sha: SHA } }), { status: 200 });
    if (url.includes("/actions/runs?")) {
      return new Response(JSON.stringify({ workflow_runs: [{
        id: FAILURE_RUN_ID,
        name: "CI",
        status: "in_progress",
        conclusion: "failure",
        head_branch: "main",
        head_sha: SHA,
        event: "push",
        updated_at: new Date(NOW - 30_000).toISOString(),
      }] }), { status: 200 });
    }
    if (url.endsWith("/dispatches")) dispatched = true;
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const outcome = await runScheduledAutopilot({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_GITHUB_REPOSITORY: "cinamoncandy/NUSA",
    NUSA_EXECUTION_COORDINATOR: namespace(),
  }, NOW, fetchImpl);

  assert.equal(outcome.status, "ABSTAINED");
  assert.equal(outcome.reason, "exact-main-canonical-ci-not-found");
  assert.equal(dispatched, false);
});
