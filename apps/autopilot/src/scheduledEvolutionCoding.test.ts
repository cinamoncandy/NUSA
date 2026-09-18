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

function runMetadata(path = ".github/workflows/ci.yml") {
  return new Response(JSON.stringify({ path, head_branch: "main", event: "push" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function jobs(stepName: string, jobName = "validation") {
  return new Response(JSON.stringify({ jobs: [{ name: jobName, steps: [{ name: stepName, conclusion: "failure" }] }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function trustedRegressionJobs(acquiredFailure = true) {
  return new Response(JSON.stringify({ jobs: [{
    name: "validation",
    steps: [
      { name: "Install locked dependencies", conclusion: "success" },
      { name: "Preflight", conclusion: "success" },
      { name: "Build", conclusion: "success" },
      { name: "Read-only MCP gateway regression", conclusion: acquiredFailure ? "failure" : "success" },
    ],
  }] }), { status: 200, headers: { "content-type": "application/json" } });
}

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

test("scheduled evolution coding routes only an explicit trusted repository-code contract through dispatch", async () => {
  let posted = false;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith(`/actions/runs/${RUN_ID}`)) return runMetadata();
    if (url.includes(`/actions/runs/${RUN_ID}/jobs?`)) return trustedRegressionJobs();
    if (url.endsWith("/branches/main")) return new Response(JSON.stringify({ commit: { sha: MAIN_SHA } }), { status: 200, headers: { "content-type": "application/json" } });
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
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const outcome = await runScheduledEvolutionCoding({ NUSA_GITHUB_TOKEN: "token", NUSA_EXECUTION_COORDINATOR: namespace() }, {
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
});

test("scheduled evolution coding does not infer code actionability from Build/Test-like step names", async () => {
  for (const stepName of ["Build", "Run unit tests"]) {
    let posted = false;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(`/actions/runs/${RUN_ID}`)) return runMetadata();
      if (url.includes(`/actions/runs/${RUN_ID}/jobs?`)) return jobs(stepName);
      if (url.endsWith("/dispatches")) posted = true;
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const outcome = await runScheduledEvolutionCoding({ NUSA_GITHUB_TOKEN: "token", NUSA_EXECUTION_COORDINATOR: namespace() }, {
      candidates,
      now: NOW,
      repository: "cinamoncandy/NUSA",
      mainSha: MAIN_SHA,
      workflowRunId: RUN_ID,
    }, fetchImpl);

    assert.equal(outcome.status, "ABSTAINED");
    assert.equal(outcome.reason, "workflow-not-code-actionable:UNKNOWN");
    assert.equal(posted, false);
  }
});

test("scheduled evolution coding rejects a trusted-looking test failure from an untrusted workflow", async () => {
  let posted = false;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith(`/actions/runs/${RUN_ID}`)) return runMetadata(".github/workflows/external-smoke.yml");
    if (url.includes(`/actions/runs/${RUN_ID}/jobs?`)) return trustedRegressionJobs();
    if (url.endsWith("/dispatches")) posted = true;
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const outcome = await runScheduledEvolutionCoding({ NUSA_GITHUB_TOKEN: "token", NUSA_EXECUTION_COORDINATOR: namespace() }, {
    candidates,
    now: NOW,
    repository: "cinamoncandy/NUSA",
    mainSha: MAIN_SHA,
    workflowRunId: RUN_ID,
  }, fetchImpl);

  assert.equal(outcome.status, "ABSTAINED");
  assert.equal(outcome.reason, "workflow-not-code-actionable:UNKNOWN");
  assert.equal(posted, false);
});

test("scheduled evolution coding classifies exact-main deployment wait as evidence missing and does not dispatch", async () => {
  let posted = false;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith(`/actions/runs/${RUN_ID}`)) return runMetadata(".github/workflows/autopilot-cloudflare-credential-preflight.yml");
    if (url.includes(`/actions/runs/${RUN_ID}/jobs?`)) return jobs("Require successful exact-main Cloudflare deployment", "preflight");
    if (url.endsWith("/dispatches")) posted = true;
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const outcome = await runScheduledEvolutionCoding({ NUSA_GITHUB_TOKEN: "token", NUSA_EXECUTION_COORDINATOR: namespace() }, {
    candidates,
    now: NOW,
    repository: "cinamoncandy/NUSA",
    mainSha: MAIN_SHA,
    workflowRunId: RUN_ID,
  }, fetchImpl);

  assert.equal(outcome.status, "ABSTAINED");
  assert.equal(outcome.reason, "workflow-not-code-actionable:EVIDENCE_MISSING");
  assert.equal(posted, false);
});

test("scheduled evolution coding routes credential failures to human-only and does not dispatch", async () => {
  let posted = false;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith(`/actions/runs/${RUN_ID}`)) return runMetadata(".github/workflows/autopilot-cloudflare-credential-preflight.yml");
    if (url.includes(`/actions/runs/${RUN_ID}/jobs?`)) return jobs("Validate Cloudflare credential inputs", "preflight");
    if (url.endsWith("/dispatches")) posted = true;
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const outcome = await runScheduledEvolutionCoding({ NUSA_GITHUB_TOKEN: "token", NUSA_EXECUTION_COORDINATOR: namespace() }, {
    candidates,
    now: NOW,
    repository: "cinamoncandy/NUSA",
    mainSha: MAIN_SHA,
    workflowRunId: RUN_ID,
  }, fetchImpl);

  assert.equal(outcome.status, "ABSTAINED");
  assert.equal(outcome.reason, "workflow-not-code-actionable:HUMAN_ONLY");
  assert.equal(posted, false);
});

test("scheduled evolution coding fails closed when raw workflow failure has no causal failed-step evidence", async () => {
  let posted = false;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith(`/actions/runs/${RUN_ID}`)) return runMetadata();
    if (url.includes(`/actions/runs/${RUN_ID}/jobs?`)) return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    if (url.endsWith("/dispatches")) posted = true;
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const outcome = await runScheduledEvolutionCoding({ NUSA_GITHUB_TOKEN: "token", NUSA_EXECUTION_COORDINATOR: namespace() }, {
    candidates,
    now: NOW,
    repository: "cinamoncandy/NUSA",
    mainSha: MAIN_SHA,
    workflowRunId: RUN_ID,
  }, fetchImpl);

  assert.equal(outcome.status, "ABSTAINED");
  assert.equal(outcome.reason, "workflow-not-code-actionable:UNKNOWN");
  assert.equal(posted, false);
});

test("scheduled evolution coding suppresses duplicate coding dispatch after trusted actionability proof", async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith(`/actions/runs/${RUN_ID}`)) return runMetadata();
    if (url.includes(`/actions/runs/${RUN_ID}/jobs?`)) return trustedRegressionJobs();
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  const outcome = await runScheduledEvolutionCoding({ NUSA_GITHUB_TOKEN: "token", NUSA_EXECUTION_COORDINATOR: namespace(false) }, {
    candidates,
    now: NOW,
    repository: "cinamoncandy/NUSA",
    mainSha: MAIN_SHA,
    workflowRunId: RUN_ID,
  }, fetchImpl);
  assert.equal(outcome.status, "DUPLICATE_SUPPRESSED");
  assert.equal(outcome.reason, "ALREADY_DISPATCHED");
});

test("scheduled evolution coding fails closed on repeated fresh failure evidence", async () => {
  const repeated = [0, 1, 2].map((offset) => ({ ...candidates[0], id: RUN_ID + 10 + offset, head_sha: String(offset + 1).repeat(40) }));
  const outcome = await runScheduledEvolutionCoding({ NUSA_GITHUB_TOKEN: "token", NUSA_EXECUTION_COORDINATOR: namespace() }, {
    candidates: repeated,
    now: NOW,
    repository: "cinamoncandy/NUSA",
    mainSha: MAIN_SHA,
    workflowRunId: RUN_ID,
  });
  assert.equal(outcome.status, "ABSTAINED");
  assert.equal(outcome.reason, "circuit-open");
});
