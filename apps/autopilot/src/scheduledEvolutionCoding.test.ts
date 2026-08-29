import test from "node:test";
import assert from "node:assert/strict";
import { runScheduledEvolutionCoding } from "./scheduledEvolutionCoding";
import type { ExecutionCoordinatorNamespace } from "./executionCoordinator";

const MAIN_SHA = "a".repeat(40);
const FAILED_SHA = "b".repeat(40);
const RUN_ID = 9001;
const NOW = 1_787_968_000_000;

function namespace(acquired = true): ExecutionCoordinatorNamespace {
  return {
    idFromName: (name: string) => ({ name }),
    get: () => ({
      async fetch(input: RequestInfo | URL) {
        const url = String(input);
        if (url.endsWith("/acquire")) return new Response(JSON.stringify(acquired ? { acquired: true } : { acquired: false, reason: "ALREADY_DISPATCHED" }), { status: acquired ? 201 : 409, headers: { "content-type": "application/json" } });
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

test("scheduled evolution coding stays interface-ready without configured coding engine", async () => {
  const outcome = await runScheduledEvolutionCoding({ NUSA_GITHUB_TOKEN: "token", NUSA_EXECUTION_COORDINATOR: namespace() }, {
    candidates,
    now: NOW,
    repository: "cinamoncandy/NUSA",
    mainSha: MAIN_SHA,
    workflowRunId: RUN_ID,
  });
  assert.equal(outcome.status, "INTERFACE_READY");
  assert.equal(outcome.liveAuthority, "NONE");
  assert.equal(outcome.productionMutationAllowed, false);
  assert.equal(outcome.aiAuthority, "ZERO_AUTHORITY");
});

test("scheduled evolution coding routes fresh evidence through existing CodingRunner exact-head verification", async () => {
  let posted = false;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith(`/commits/${MAIN_SHA}`)) return new Response(JSON.stringify({ sha: MAIN_SHA }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.endsWith(`/actions/runs/${RUN_ID}`)) return new Response(JSON.stringify({ id: RUN_ID, head_sha: MAIN_SHA, head_branch: "main", status: "completed", conclusion: "success", repository: { full_name: "cinamoncandy/NUSA" } }), { status: 200, headers: { "content-type": "application/json" } });
    if (url === "https://coding.example/run") {
      posted = true;
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.headSha, MAIN_SHA);
      assert.equal(body.workflowRunId, RUN_ID);
      assert.equal(body.constraints.liveAuthority, "NONE");
      assert.equal(body.constraints.productionMutationAllowed, false);
      assert.equal(body.constraints.aiAuthority, "ZERO_AUTHORITY");
      return new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const outcome = await runScheduledEvolutionCoding({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_AI_CODING_ENDPOINT: "https://coding.example/run",
    NUSA_AI_CODING_TOKEN: "ai-token",
    NUSA_EXECUTION_COORDINATOR: namespace(),
  }, {
    candidates,
    now: NOW,
    repository: "cinamoncandy/NUSA",
    mainSha: MAIN_SHA,
    workflowRunId: RUN_ID,
  }, fetchImpl);

  assert.equal(posted, true);
  assert.equal(outcome.status, "EXECUTION_ACCEPTED");
  assert.equal(outcome.selectedSignalIds.length, 1);
});

test("scheduled evolution coding fails closed on repeated fresh failure evidence", async () => {
  const repeated = [0, 1, 2].map((offset) => ({ ...candidates[0], id: RUN_ID + 10 + offset, head_sha: String(offset + 1).repeat(40) }));
  const outcome = await runScheduledEvolutionCoding({
    NUSA_GITHUB_TOKEN: "token",
    NUSA_AI_CODING_ENDPOINT: "https://coding.example/run",
    NUSA_AI_CODING_TOKEN: "ai-token",
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
