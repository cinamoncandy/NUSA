import test from "node:test";
import assert from "node:assert/strict";
import { runScheduledEvolutionCoding } from "./scheduledEvolutionCoding";
import type { ExecutionCoordinatorNamespace } from "./executionCoordinator";

const MAIN_SHA = "a".repeat(40);
const FAILED_SHA = "b".repeat(40);
const RUN_ID = 9001;
const NOW = 1_787_968_000_000;

function namespace(acquired = true, record: Record<string, unknown> | null = null, events: string[] = []): ExecutionCoordinatorNamespace {
  return {
    idFromName: (name: string) => ({ name }),
    get: () => ({
      async fetch(input: RequestInfo | URL) {
        const url = String(input);
        if (url.endsWith("/active-wip")) { events.push("active-wip:read"); return new Response(JSON.stringify({ claims: [], activeExecutions: 0 }), { status: 200, headers: { "content-type": "application/json" } }); }
        if (url.endsWith("/active-wip/admit")) { events.push("active-wip:admit"); return new Response(JSON.stringify({ admitted: true }), { status: 201, headers: { "content-type": "application/json" } }); }
        if (url.endsWith("/active-wip/complete")) { events.push("active-wip:complete"); return new Response(JSON.stringify({ completed: true }), { status: 200, headers: { "content-type": "application/json" } }); }
        if (url.endsWith("/execution")) return new Response(JSON.stringify({ record }), { status: 200, headers: { "content-type": "application/json" } });
        if (url.endsWith("/acquire")) { events.push("persistent:acquire"); return new Response(JSON.stringify(acquired ? { acquired: true } : { acquired: false, reason: "ALREADY_DISPATCHED" }), { status: acquired ? 201 : 409, headers: { "content-type": "application/json" } }); }
        if (url.endsWith("/release")) { events.push("persistent:release"); return new Response(JSON.stringify({ released: true }), { status: 200, headers: { "content-type": "application/json" } }); }
        if (url.endsWith("/dispatched")) return new Response(JSON.stringify({ updated: true }), { status: 200, headers: { "content-type": "application/json" } });
        return new Response("not found", { status: 404 });
      },
    }),
  };
}

const candidates = [{
  id: RUN_ID + 1,
  name: "CI",
  conclusion: "failure",
  head_branch: "main",
  head_sha: FAILED_SHA,
  event: "push",
  completed_at: new Date(NOW - 60_000).toISOString(),
}];

test("scheduled evolution coding abstains without GitHub transport", async () => {
  const outcome = await runScheduledEvolutionCoding({ NUSA_EXECUTION_COORDINATOR: namespace() }, {
    candidates,
    now: NOW,
    repository: "cinamoncandy/NUSA",
    mainSha: MAIN_SHA,
    workflowRunId: RUN_ID,
  });
  assert.equal(outcome.status, "ABSTAINED");
  assert.equal(outcome.reason, "github-token-not-configured");
  assert.equal(outcome.liveAuthority, "NONE");
  assert.equal(outcome.productionMutationAllowed, false);
  assert.equal(outcome.aiAuthority, "ZERO_AUTHORITY");
});

test("scheduled evolution coding routes fresh evidence through existing repository dispatch spine", async () => {
  let posted = false;
  const events: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/branches/main")) {
      return new Response(JSON.stringify({ commit: { sha: MAIN_SHA } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/dispatches")) {
      posted = true;
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.event_type, "nusa_autopilot_execution");
      assert.equal(body.client_payload.kind, "REPOSITORY_AUTOPILOT");
      assert.equal(body.client_payload.head_sha, MAIN_SHA);
      assert.equal(body.client_payload.workflow_run_id, RUN_ID);
      assert.equal(body.client_payload.live_authority, "NONE");
      assert.equal(body.client_payload.production_mutation_allowed, false);
      assert.equal(body.client_payload.ai_authority, "ZERO_AUTHORITY");
      assert.equal(body.client_payload.canonical_owner, "evolve");
      assert.deepEqual(body.client_payload.conflict_keys, ["workflow:ci", `head:${FAILED_SHA}`]);
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const outcome = await runScheduledEvolutionCoding({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_EXECUTION_COORDINATOR: namespace(true, null, events),
  }, {
    candidates,
    now: NOW,
    repository: "cinamoncandy/NUSA",
    mainSha: MAIN_SHA,
    workflowRunId: RUN_ID,
  }, fetchImpl);

  assert.equal(posted, true);
  assert.equal(outcome.status, "EXECUTION_ACCEPTED");
  assert.equal(outcome.reason, "github-coding-dispatch-accepted");
  assert.equal(outcome.selectedSignalIds.length, 1);
  assert.deepEqual(events, ["active-wip:read", "active-wip:admit", "persistent:acquire"]);
});

test("scheduled evolution coding suppresses duplicate coding dispatch", async () => {
  const outcome = await runScheduledEvolutionCoding({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_EXECUTION_COORDINATOR: namespace(false),
  }, {
    candidates,
    now: NOW,
    repository: "cinamoncandy/NUSA",
    mainSha: MAIN_SHA,
    workflowRunId: RUN_ID,
  });
  assert.equal(outcome.status, "DUPLICATE_SUPPRESSED");
  assert.equal(outcome.reason, "ALREADY_DISPATCHED");
});

test("scheduled evolution coding uses the coordinator lease to stop selection before acquisition", async () => {
  const dedupeKey = `evolve-coding:${MAIN_SHA}:gha:ci:${FAILED_SHA}:failure`;
  const events: string[] = [];
  const outcome = await runScheduledEvolutionCoding({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_EXECUTION_COORDINATOR: namespace(true, {
      dedupeKey,
      executionId: "existing-execution",
      state: "LEASED",
      leaseExpiresAt: NOW + 60_000,
      updatedAt: NOW - 120_000,
    }, events),
  }, {
    candidates,
    now: NOW,
    repository: "cinamoncandy/NUSA",
    mainSha: MAIN_SHA,
    workflowRunId: RUN_ID,
  });
  assert.equal(outcome.status, "ABSTAINED");
  assert.equal(outcome.reason, "concurrency-limit-reached");
  assert.deepEqual(events, ["active-wip:read"]);
});

test("scheduled evolution coding fails closed on repeated fresh failure evidence", async () => {
  const repeated = [0, 1, 2].map((offset) => ({ ...candidates[0], id: RUN_ID + 10 + offset, head_sha: String(offset + 1).repeat(40) }));
  const outcome = await runScheduledEvolutionCoding({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_EXECUTION_COORDINATOR: namespace(),
  }, {
    candidates: repeated,
    now: NOW,
    repository: "cinamoncandy/NUSA",
    mainSha: MAIN_SHA,
    workflowRunId: RUN_ID,
  });
  assert.equal(outcome.status, "ABSTAINED");
  assert.equal(outcome.reason, "circuit-open");
});
