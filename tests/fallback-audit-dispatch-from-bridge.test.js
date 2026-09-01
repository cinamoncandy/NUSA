const assert = require("node:assert/strict");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

const repository = "cinamoncandy/NUSA";
const headSha = "a".repeat(40);
const baseSha = "b".repeat(40);
const runId = 123456;
const prNumber = 1404;
const apiBase = "https://api.github.example";

const modulePromise = import(pathToFileURL(path.resolve("scripts/fallback-audit-dispatch-from-bridge.mjs")).href);

function canonicalEvent(overrides = {}) {
  return {
    action: "completed",
    repository: { full_name: repository },
    workflow_run: {
      id: runId,
      name: "CI",
      status: "completed",
      conclusion: "success",
      event: "pull_request",
      head_sha: headSha,
      ...overrides,
    },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function exactEvidenceFetch(options = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (url === `${apiBase}/repos/${repository}/actions/runs/${runId}`) {
      return jsonResponse({
        id: runId,
        name: options.ciName ?? "CI",
        event: "pull_request",
        status: "completed",
        conclusion: options.ciConclusion ?? "success",
        head_sha: options.ciHeadSha ?? headSha,
        repository: { full_name: repository },
        pull_requests: options.emptyRunPullRequests ? [] : [{ number: prNumber }],
      });
    }
    if (url === `${apiBase}/repos/${repository}/commits/${headSha}/pulls`) {
      return jsonResponse(options.associatedPullRequests ?? [{
        number: prNumber,
        state: "open",
        head: { sha: headSha },
        base: { ref: "main", sha: baseSha, repo: { full_name: repository } },
      }]);
    }
    if (url === `${apiBase}/repos/${repository}/pulls/${prNumber}`) {
      return jsonResponse({
        number: prNumber,
        state: "open",
        head: { sha: options.prHeadSha ?? headSha },
        base: {
          ref: options.baseRef ?? "main",
          sha: options.prBaseSha ?? baseSha,
          repo: { full_name: options.baseRepository ?? repository },
        },
      });
    }
    if (url === `${apiBase}/repos/${repository}/branches/main`) {
      return jsonResponse({ commit: { sha: options.mainSha ?? baseSha } });
    }
    if (url === `${apiBase}/repos/${repository}/dispatches` && init.method === "POST") {
      return new Response(null, { status: options.dispatchStatus ?? 204 });
    }
    throw new Error(`unexpected fetch: ${init.method ?? "GET"} ${url}`);
  };
  return { fetchImpl, calls };
}

test("without exact Worker token-missing evidence the Bridge cannot fallback", async () => {
  const { runAuditDispatchFallback } = await modulePromise;
  let calls = 0;
  const result = await runAuditDispatchFallback({
    eventPayload: canonicalEvent(),
    repository,
    githubToken: "ephemeral-actions-token",
    bridgeEligibility: "false",
    apiBase,
    fetchImpl: async () => { calls += 1; throw new Error("must not fetch"); },
  });
  assert.equal(result.status, "NO_ACTION");
  assert.equal(result.reason, "worker-event-did-not-explicitly-require-token-fallback");
  assert.equal(calls, 0);
});

test("explicit Worker token-missing evidence dispatches exactly one bounded AUDIT_REQUEST after exact validation", async () => {
  const { runAuditDispatchFallback } = await modulePromise;
  const { fetchImpl, calls } = exactEvidenceFetch();
  const result = await runAuditDispatchFallback({
    eventPayload: canonicalEvent(),
    repository,
    githubToken: "ephemeral-actions-token",
    bridgeEligibility: "true",
    apiBase,
    fetchImpl,
  });
  assert.equal(result.status, "FALLBACK_DISPATCHED");
  assert.equal(result.prNumber, prNumber);
  assert.equal(result.headSha, headSha);
  const dispatches = calls.filter((call) => call.url.endsWith("/dispatches"));
  assert.equal(dispatches.length, 1);
  const body = JSON.parse(dispatches[0].init.body);
  assert.equal(body.event_type, "nusa_autopilot_execution");
  assert.deepEqual(body.client_payload, {
    kind: "AUDIT_REQUEST",
    repository,
    head_sha: headSha,
    pr_number: prNumber,
    workflow_run_id: runId,
    reason: `audit:pr:${prNumber}:ci:${runId}:${headSha}`,
    execution_id: `audit:${prNumber}:${runId}`,
    dedupe_key: `audit:${prNumber}:${runId}:${headSha}`,
    live_authority: "NONE",
    production_mutation_allowed: false,
    ai_authority: "ZERO_AUTHORITY",
  });
});

test("empty workflow_run.pull_requests resolves exactly one canonical open PR by exact head", async () => {
  const { runAuditDispatchFallback } = await modulePromise;
  const { fetchImpl, calls } = exactEvidenceFetch({ emptyRunPullRequests: true });
  const result = await runAuditDispatchFallback({
    eventPayload: canonicalEvent(),
    repository,
    githubToken: "ephemeral-actions-token",
    bridgeEligibility: "true",
    apiBase,
    fetchImpl,
  });
  assert.equal(result.status, "FALLBACK_DISPATCHED");
  assert.equal(calls.some((call) => call.url.endsWith(`/commits/${headSha}/pulls`)), true);
});

test("stale PR head fails closed before repository dispatch", async () => {
  const { runAuditDispatchFallback } = await modulePromise;
  const { fetchImpl, calls } = exactEvidenceFetch({ prHeadSha: "c".repeat(40) });
  await assert.rejects(() => runAuditDispatchFallback({
    eventPayload: canonicalEvent(),
    repository,
    githubToken: "ephemeral-actions-token",
    bridgeEligibility: "true",
    apiBase,
    fetchImpl,
  }), /AUDIT_FALLBACK_STALE_PR_HEAD/);
  assert.equal(calls.some((call) => call.url.endsWith("/dispatches")), false);
});

test("base movement after CI fails closed before repository dispatch", async () => {
  const { runAuditDispatchFallback } = await modulePromise;
  const { fetchImpl, calls } = exactEvidenceFetch({ mainSha: "d".repeat(40) });
  await assert.rejects(() => runAuditDispatchFallback({
    eventPayload: canonicalEvent(),
    repository,
    githubToken: "ephemeral-actions-token",
    bridgeEligibility: "true",
    apiBase,
    fetchImpl,
  }), /AUDIT_FALLBACK_BASE_MAIN_MISMATCH/);
  assert.equal(calls.some((call) => call.url.endsWith("/dispatches")), false);
});

test("wrong CI head fails closed before PR or repository dispatch", async () => {
  const { runAuditDispatchFallback } = await modulePromise;
  const { fetchImpl, calls } = exactEvidenceFetch({ ciHeadSha: "e".repeat(40) });
  await assert.rejects(() => runAuditDispatchFallback({
    eventPayload: canonicalEvent(),
    repository,
    githubToken: "ephemeral-actions-token",
    bridgeEligibility: "true",
    apiBase,
    fetchImpl,
  }), /AUDIT_FALLBACK_CI_HEAD_MISMATCH/);
  assert.equal(calls.some((call) => call.url.endsWith("/dispatches")), false);
});

test("non canonical PR CI event never gets fallback mutation authority", async () => {
  const { runAuditDispatchFallback } = await modulePromise;
  let calls = 0;
  const result = await runAuditDispatchFallback({
    eventPayload: canonicalEvent({ event: "push" }),
    repository,
    githubToken: "ephemeral-actions-token",
    bridgeEligibility: "true",
    apiBase,
    fetchImpl: async () => { calls += 1; throw new Error("must not fetch"); },
  });
  assert.equal(result.status, "NO_ACTION");
  assert.equal(result.reason, "not-canonical-pr-ci-success");
  assert.equal(calls, 0);
});

test("ambiguous exact-head PR identity fails closed", async () => {
  const { runAuditDispatchFallback } = await modulePromise;
  const candidate = (number) => ({
    number,
    state: "open",
    head: { sha: headSha },
    base: { ref: "main", sha: baseSha, repo: { full_name: repository } },
  });
  const { fetchImpl, calls } = exactEvidenceFetch({
    emptyRunPullRequests: true,
    associatedPullRequests: [candidate(prNumber), candidate(prNumber + 1)],
  });
  await assert.rejects(() => runAuditDispatchFallback({
    eventPayload: canonicalEvent(),
    repository,
    githubToken: "ephemeral-actions-token",
    bridgeEligibility: "true",
    apiBase,
    fetchImpl,
  }), /AUDIT_FALLBACK_PR_IDENTITY_AMBIGUOUS/);
  assert.equal(calls.some((call) => call.url.endsWith("/dispatches")), false);
});
