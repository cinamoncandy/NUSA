import test from "node:test";
import assert from "node:assert/strict";
import { runScheduledAutopilot } from "./scheduledRuntime";
import type { ExecutionCoordinatorNamespace } from "./executionCoordinator";

const SHA = "a".repeat(40);
const FAILED_SHA = "b".repeat(40);
const RUN_ID = 4242;
const NOW = 1_787_968_000_000;

function namespace(acquired: boolean): ExecutionCoordinatorNamespace {
  return {
    idFromName: (name: string) => ({ name }),
    get: () => ({
      async fetch(input: RequestInfo | URL) {
        const url = String(input);
        if (url.endsWith("/provider-capacity-wait")) {
          return new Response(JSON.stringify({ wait: null }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (url.endsWith("/execution")) return new Response(JSON.stringify({ record: null }), { status: 200, headers: { "content-type": "application/json" } });
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
    if (url.includes("/actions/workflows/ci.yml/runs?")) {
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
  assert.deepEqual(outcome.discoveredOpportunityIds, []);
  assert.equal(outcome.liveAuthority, "NONE");
  assert.equal(outcome.productionMutationAllowed, false);
  assert.equal(outcome.aiAuthority, "ZERO_AUTHORITY");
});

test("scheduled runtime checks a persisted provider wait before spending GitHub search and workflow API calls", async () => {
  const future = NOW + 60 * 60 * 1000;
  const stop = {
    schemaVersion: 1,
    taskId: "issue-2118",
    executionId: "evolve-coding:existing-work",
    provider: "workers-ai",
    headSha: SHA,
    stopReason: "WORKERS_AI_DAILY_QUOTA_EXHAUSTED",
    stoppedAt: NOW - 1_000,
    attemptCount: 1,
    lastFailure: "WORKERS_AI_DAILY_QUOTA_EXHAUSTED",
    nextRetryAt: future,
    resumeCondition: "provider-capacity-and-exact-head-revalidation",
    dedupeKey: "existing-dedupe",
    evidenceRef: "coding-evidence:existing-work",
  };
  const coordinator: ExecutionCoordinatorNamespace = {
    idFromName: (name) => ({ name }),
    get: () => ({
      async fetch(input: RequestInfo | URL) {
        assert.match(String(input), /\/provider-capacity-wait$/);
        return new Response(JSON.stringify({ wait: stop }), { status: 200, headers: { "content-type": "application/json" } });
      },
    }),
  };
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    assert.ok(url.endsWith("/branches/main"), "provider wait must skip backlog/workflow evidence: " + url);
    return githubFetch()(input, init);
  }) as typeof fetch;

  const outcome = await runScheduledAutopilot({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_GITHUB_REPOSITORY: "cinamoncandy/NUSA",
    NUSA_EXECUTION_COORDINATOR: coordinator,
  }, NOW, fetchImpl);

  assert.equal(outcome.status, "WAITING_RATE_LIMIT");
  assert.equal(outcome.reason, "waiting-provider-capacity");
  assert.equal(outcome.headSha, SHA);
  assert.equal(outcome.workflowRunId, null);
  assert.deepEqual(calls, ["https://api.github.com/repos/cinamoncandy/NUSA/branches/main"]);
  assert.equal(outcome.liveAuthority, "NONE");
  assert.equal(outcome.productionMutationAllowed, false);
  assert.equal(outcome.aiAuthority, "ZERO_AUTHORITY");
});

test("scheduled runtime fails closed when provider-wait state cannot be read", async () => {
  let githubCalls = 0;
  const coordinator: ExecutionCoordinatorNamespace = {
    idFromName: (name) => ({ name }),
    get: () => ({ async fetch() { return new Response("unavailable", { status: 503 }); } }),
  };
  const fetchImpl = (async () => {
    githubCalls += 1;
    throw new Error("GitHub must not be queried when provider state is unknown");
  }) as typeof fetch;
  const outcome = await runScheduledAutopilot({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_EXECUTION_COORDINATOR: coordinator,
  }, NOW, fetchImpl);
  assert.equal(outcome.status, "ABSTAINED");
  assert.equal(outcome.reason, "provider-capacity-state-unavailable");
  assert.equal(githubCalls, 0);
});

test("scheduled runtime reuses exact-main canonical CI and existing dispatch spine", async () => {
  const outcome = await runScheduledAutopilot({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_GITHUB_REPOSITORY: "cinamoncandy/NUSA",
    NUSA_EXECUTION_COORDINATOR: namespace(true),
  }, NOW, githubFetch());

  assert.equal(outcome.status, "EXECUTION_DISPATCHED");
  assert.equal(outcome.headSha, SHA);
  assert.equal(outcome.workflowRunId, RUN_ID);
  assert.equal(outcome.executor?.status, "DISPATCHED");
  assert.deepEqual(outcome.discoveredOpportunityIds, []);
});

test("scheduled runtime discovers fresh failed main workflow evidence without dispatching from it", async () => {
  const fetchWithFailure = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/branches/main")) {
      return new Response(JSON.stringify({ commit: { sha: SHA } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/actions/workflows/ci.yml/runs?")) {
      return new Response(JSON.stringify({ workflow_runs: [{
        id: RUN_ID,
        name: "CI",
        conclusion: "success",
        head_branch: "main",
        head_sha: SHA,
        event: "push",
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/actions/runs?")) {
      return new Response(JSON.stringify({ workflow_runs: [
        {
          id: RUN_ID,
          name: "CI",
          conclusion: "success",
          head_branch: "main",
          head_sha: SHA,
          event: "push",
        },
        {
          id: RUN_ID + 1,
          name: "CI",
          conclusion: "failure",
          head_branch: "main",
          head_sha: FAILED_SHA,
          event: "push",
          completed_at: new Date(NOW - 60_000).toISOString(),
        },
      ] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/dispatches")) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.client_payload.head_sha, SHA);
      assert.equal(body.client_payload.workflow_run_id, RUN_ID);
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const outcome = await runScheduledAutopilot({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_EXECUTION_COORDINATOR: namespace(true),
  }, NOW, fetchWithFailure);

  assert.equal(outcome.status, "EXECUTION_DISPATCHED");
  assert.deepEqual(outcome.discoveredOpportunityIds, [`gha:ci:${FAILED_SHA}:failure`]);
  assert.equal(outcome.liveAuthority, "NONE");
  assert.equal(outcome.productionMutationAllowed, false);
  assert.equal(outcome.aiAuthority, "ZERO_AUTHORITY");
});

test("scheduled runtime excludes stale failed workflow evidence", async () => {
  const fetchWithStaleFailure = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/branches/main")) {
      return new Response(JSON.stringify({ commit: { sha: SHA } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/actions/workflows/ci.yml/runs?")) {
      return new Response(JSON.stringify({ workflow_runs: [
        { id: RUN_ID, name: "CI", conclusion: "success", head_branch: "main", head_sha: SHA, event: "push" },
      ] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/actions/runs?")) {
      return new Response(JSON.stringify({ workflow_runs: [
        { id: RUN_ID, name: "CI", conclusion: "success", head_branch: "main", head_sha: SHA, event: "push" },
        { id: RUN_ID + 1, name: "CI", conclusion: "failure", head_branch: "main", head_sha: FAILED_SHA, event: "push", completed_at: new Date(NOW - 25 * 60 * 60 * 1000).toISOString() },
      ] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/dispatches")) return new Response(null, { status: 204 });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const outcome = await runScheduledAutopilot({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_EXECUTION_COORDINATOR: namespace(true),
  }, NOW, fetchWithStaleFailure);

  assert.deepEqual(outcome.discoveredOpportunityIds, []);
});

test("scheduled runtime cannot bypass persistent dedupe", async () => {
  const outcome = await runScheduledAutopilot({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_EXECUTION_COORDINATOR: namespace(false),
  }, NOW, githubFetch());

  assert.equal(outcome.status, "DUPLICATE_EXECUTION_SUPPRESSED");
  assert.equal(outcome.reason, "ALREADY_DISPATCHED");
});

test("scheduled runtime accepts exact-main canonical CI from workflow_dispatch despite repository workflow noise", async () => {
  const base = githubFetch();
  const noisyFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/actions/workflows/ci.yml/runs?")) {
      return new Response(JSON.stringify({ workflow_runs: [{
        id: RUN_ID,
        name: "CI",
        conclusion: "success",
        head_branch: "main",
        head_sha: SHA,
        event: "workflow_dispatch",
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/actions/runs?")) {
      return new Response(JSON.stringify({ workflow_runs: Array.from({ length: 50 }, (_, index) => ({
        id: RUN_ID + 100 + index,
        name: "Workflow Noise",
        conclusion: "success",
        status: "completed",
        head_branch: "main",
        head_sha: SHA,
        event: "workflow_run",
      })) }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return base(input, init);
  }) as typeof fetch;

  const outcome = await runScheduledAutopilot({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_EXECUTION_COORDINATOR: namespace(true),
  }, NOW, noisyFetch);

  assert.equal(outcome.status, "EXECUTION_DISPATCHED");
  assert.equal(outcome.headSha, SHA);
  assert.equal(outcome.workflowRunId, RUN_ID);
});

test("scheduled runtime fails closed when latest main lacks exact canonical CI evidence", async () => {
  const fetchWithoutExactCi = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/branches/main")) {
      return new Response(JSON.stringify({ commit: { sha: SHA } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/actions/workflows/ci.yml/runs?")) {
      return new Response(JSON.stringify({ workflow_runs: [{ id: RUN_ID, name: "CI", conclusion: "success", head_branch: "main", head_sha: FAILED_SHA, event: "push" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/actions/runs?")) {
      return new Response(JSON.stringify({ workflow_runs: [{ id: RUN_ID, name: "CI", conclusion: "success", head_branch: "main", head_sha: FAILED_SHA, event: "push" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const outcome = await runScheduledAutopilot({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_EXECUTION_COORDINATOR: namespace(true),
  }, NOW, fetchWithoutExactCi);

  assert.equal(outcome.status, "ABSTAINED");
  assert.equal(outcome.reason, "exact-main-canonical-ci-not-found");
  assert.equal(outcome.headSha, SHA);
});

test("scheduled runtime does not probe every open PR on each tick (GitHub budget)", async () => {
  const base = githubFetch();
  const calls: string[] = [];
  const pulls = Array.from({ length: 40 }, (_, i) => ({ number: 5000 + i, title: `fix: work ${i}`, body: "Refs #903", pull_request: {} }));
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/search/issues?") && url.includes("is%3Apr")) {
      return new Response(JSON.stringify({ total_count: pulls.length, items: pulls }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/search/issues?")) {
      return new Response(JSON.stringify({ total_count: 0, items: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return base(input, init);
  }) as typeof fetch;
  await runScheduledAutopilot({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_GITHUB_REPOSITORY: "cinamoncandy/NUSA",
    NUSA_EXECUTION_COORDINATOR: namespace(true),
  }, NOW, fetchImpl);
  const probes = calls.filter((url) => /\/pulls\/\d+$|\/compare\//.test(url));
  assert.equal(probes.length, 0, "no eligible issue means no PR staleness probe at all");
  assert.ok(calls.length <= 8, `a tick with 40 open PRs must stay small, saw ${calls.length} GitHub calls`);
});
