import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AutopilotDispatchPlan } from "./dispatchPlanner";
import { resolveCanonicalPrCiForReady } from "./githubCanonicalPrCiResolver";

const HEAD = "a".repeat(40);
const ready: AutopilotDispatchPlan = Object.freeze({
  kind: "PR_CHANGED",
  repository: "cinamoncandy/NUSA",
  headSha: HEAD,
  prNumber: 1955,
  workflowRunId: null,
  reason: "pull-request:ready_for_review",
  mutationAllowed: false,
});

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: 35195500001,
    name: "CI",
    path: ".github/workflows/ci.yml",
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    head_sha: HEAD,
    repository: { full_name: "cinamoncandy/NUSA" },
    pull_requests: [{
      number: 1955,
      head: { sha: HEAD },
      base: { ref: "main" },
    }],
    ...overrides,
  };
}

function response(workflowRuns: readonly unknown[], totalCount = workflowRuns.length): Response {
  return new Response(JSON.stringify({ total_count: totalCount, workflow_runs: workflowRuns }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const config = { token: "token", allowedRepository: "cinamoncandy/NUSA", apiBaseUrl: "https://api.example.test" };

describe("resolveCanonicalPrCiForReady", () => {
  it("resolves one successful canonical CI run at the exact ready PR head", async () => {
    const calls: string[] = [];
    const result = await resolveCanonicalPrCiForReady(ready, configWith(async (input) => {
      calls.push(String(input));
      return response([run()]);
    }));

    assert.equal(result.resolved, true);
    assert.deepEqual(result.dispatch, {
      kind: "PR_CI_SUCCEEDED",
      repository: "cinamoncandy/NUSA",
      headSha: HEAD,
      prNumber: 1955,
      workflowRunId: 35195500001,
      workflowRunAttempt: 1,
      reason: "pull-request-ci-success:ready-for-review-replay",
      mutationAllowed: false,
    });
    const url = new URL(calls[0]!);
    assert.equal(url.pathname, "/repos/cinamoncandy/NUSA/actions/workflows/ci.yml/runs");
    assert.equal(url.searchParams.get("head_sha"), HEAD);
    assert.equal(url.searchParams.get("event"), "pull_request");
    assert.equal(url.searchParams.get("status"), "completed");
    assert.equal(url.searchParams.get("per_page"), "100");
    assert.equal(url.searchParams.get("page"), "1");
  });

  it("paginates deterministically before accepting exact-SHA evidence", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => run({
      id: index + 1,
      name: "Auxiliary",
    }));
    const pages: number[] = [];
    const result = await resolveCanonicalPrCiForReady(ready, configWith(async (input) => {
      const page = Number(new URL(String(input)).searchParams.get("page"));
      pages.push(page);
      return page === 1 ? response(firstPage, 101) : response([run()], 101);
    }));
    assert.equal(result.resolved, false);
    assert.equal(result.reason, "canonical-ci-run-ambiguous");
    assert.deepEqual(pages, [1, 2]);
  });

  it("fails closed for stale/wrong head and every non-canonical identity field", async () => {
    const cases: ReadonlyArray<[string, Record<string, unknown>]> = [
      ["stale head", { head_sha: "b".repeat(40) }],
      ["wrong name", { name: "Build" }],
      ["wrong path", { path: ".github/workflows/other.yml" }],
      ["wrong event", { event: "push" }],
      ["not completed", { status: "in_progress" }],
      ["wrong repository", { repository: { full_name: "other/repo" } }],
      ["wrong PR", { pull_requests: [{ number: 1956, head: { sha: HEAD }, base: { ref: "main" } }] }],
      ["wrong PR head", { pull_requests: [{ number: 1955, head: { sha: "b".repeat(40) }, base: { ref: "main" } }] }],
      ["wrong PR base", { pull_requests: [{ number: 1955, head: { sha: HEAD }, base: { ref: "develop" } }] }],
      ["missing PR association", { pull_requests: [] }],
      ["ambiguous PR association", { pull_requests: [
        { number: 1955, head: { sha: HEAD }, base: { ref: "main" } },
        { number: 1956, head: { sha: HEAD }, base: { ref: "main" } },
      ] }],
    ];
    for (const [label, overrides] of cases) {
      const result = await resolveCanonicalPrCiForReady(ready, configWith(async () => response([run(overrides)])));
      assert.equal(result.resolved, false, label);
      assert.equal(result.reason, "canonical-ci-run-identity-invalid", label);
    }
  });

  it("fails closed for failed or cancelled CI", async () => {
    for (const conclusion of ["failure", "cancelled"]) {
      const result = await resolveCanonicalPrCiForReady(ready, configWith(async () => response([run({ conclusion })])));
      assert.equal(result.resolved, false);
      assert.equal(result.reason, "canonical-ci-run-not-successful");
    }
  });

  it("fails closed for no run, ambiguous runs, malformed evidence, and API errors", async () => {
    const noRun = await resolveCanonicalPrCiForReady(ready, configWith(async () => response([])));
    assert.equal(noRun.reason, "canonical-ci-run-not-found");

    const ambiguous = await resolveCanonicalPrCiForReady(ready, configWith(async () => response([run(), run({ id: 35195500002 })])));
    assert.equal(ambiguous.reason, "canonical-ci-run-ambiguous");

    const malformed = await resolveCanonicalPrCiForReady(ready, configWith(async () => new Response(JSON.stringify({ workflow_runs: [run()] }), { status: 200 })));
    assert.equal(malformed.reason, "github-api-response-invalid");

    const apiError = await resolveCanonicalPrCiForReady(ready, configWith(async () => new Response(null, { status: 503 })));
    assert.equal(apiError.reason, "github-api-http-503");

    const networkError = await resolveCanonicalPrCiForReady(ready, configWith(async () => { throw new Error("offline"); }));
    assert.equal(networkError.reason, "github-api-request-failed");
  });
});

function configWith(fetchImpl: typeof fetch) {
  return { ...config, fetchImpl };
}
