import test from "node:test";
import assert from "node:assert/strict";
import { runScheduledAutopilot } from "./scheduledRuntime";
import type { ExecutionCoordinatorNamespace } from "./executionCoordinator";

const SHA = "a".repeat(40);
const RUN_ID = 4242;

function namespace(acquired: boolean): ExecutionCoordinatorNamespace {
  return {
    idFromName: (name: string) => ({ name }),
    get: () => ({
      async fetch(input: RequestInfo | URL) {
        const url = String(input);
        if (url.endsWith("/acquire")) {
          return new Response(JSON.stringify(acquired
            ? { acquired: true }
            : { acquired: false, reason: "ALREADY_DISPATCHED" }), {
            status: acquired ? 201 : 409,
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

function githubFetch(dispatchStatus = 204): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/branches/main")) {
      return new Response(JSON.stringify({ commit: { sha: SHA } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/actions/runs?")) {
      return new Response(JSON.stringify({ workflow_runs: [{
        id: RUN_ID,
        name: "CI",
        conclusion: "success",
        head_branch: "main",
        head_sha: SHA,
        event: "push",
      }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/dispatches")) {
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.event_type, "nusa_autopilot_execution");
      assert.equal(body.client_payload.head_sha, SHA);
      assert.equal(body.client_payload.workflow_run_id, RUN_ID);
      assert.equal(body.client_payload.live_authority, "NONE");
      assert.equal(body.client_payload.production_mutation_allowed, false);
      assert.equal(body.client_payload.ai_authority, "ZERO_AUTHORITY");
      return new Response(null, { status: dispatchStatus });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

test("scheduled runtime abstains when authenticated evidence is unavailable", async () => {
  const outcome = await runScheduledAutopilot({}, Date.now(), githubFetch());
  assert.equal(outcome.status, "ABSTAINED");
  assert.equal(outcome.reason, "github-token-not-configured");
  assert.equal(outcome.liveAuthority, "NONE");
  assert.equal(outcome.productionMutationAllowed, false);
  assert.equal(outcome.aiAuthority, "ZERO_AUTHORITY");
});

test("scheduled runtime reuses exact-main canonical CI and existing dispatch spine", async () => {
  const outcome = await runScheduledAutopilot({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_GITHUB_REPOSITORY: "cinamoncandy/NUSA",
    NUSA_EXECUTION_COORDINATOR: namespace(true),
  }, 1_787_968_000_000, githubFetch());

  assert.equal(outcome.status, "EXECUTION_DISPATCHED");
  assert.equal(outcome.headSha, SHA);
  assert.equal(outcome.workflowRunId, RUN_ID);
  assert.equal(outcome.executor?.status, "DISPATCHED");
});

test("scheduled runtime cannot bypass persistent dedupe", async () => {
  const outcome = await runScheduledAutopilot({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_EXECUTION_COORDINATOR: namespace(false),
  }, 1_787_968_000_000, githubFetch());

  assert.equal(outcome.status, "DUPLICATE_EXECUTION_SUPPRESSED");
  assert.equal(outcome.reason, "ALREADY_DISPATCHED");
});

test("scheduled runtime fails closed when latest main lacks exact canonical CI evidence", async () => {
  const fetchWithoutExactCi = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/branches/main")) {
      return new Response(JSON.stringify({ commit: { sha: SHA } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/actions/runs?")) {
      return new Response(JSON.stringify({ workflow_runs: [{ id: RUN_ID, name: "CI", conclusion: "success", head_branch: "main", head_sha: "b".repeat(40), event: "push" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const outcome = await runScheduledAutopilot({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_EXECUTION_COORDINATOR: namespace(true),
  }, 1_787_968_000_000, fetchWithoutExactCi);

  assert.equal(outcome.status, "ABSTAINED");
  assert.equal(outcome.reason, "exact-main-canonical-ci-not-found");
  assert.equal(outcome.headSha, SHA);
});
