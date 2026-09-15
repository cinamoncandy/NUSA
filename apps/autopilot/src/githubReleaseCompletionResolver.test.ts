import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveGithubReleaseCompletion, TRUSTED_RELEASE_AUTH_APP_ID } from "./githubReleaseCompletionResolver";

const repo = "cinamoncandy/NUSA";
const head = "a".repeat(40);
const base = "b".repeat(40);
const merged = "c".repeat(40);
const runId = 123456789;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fixture(overrides: { latestAuthorizationState?: string; releaseJobConclusion?: string; convergence?: boolean; appId?: number } = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith(`/repos/${repo}/branches/main`)) return response({
      commit: { sha: merged },
      protected: true,
      protection: { required_status_checks: { enforcement_level: "everyone", checks: [{ context: "nusa/release-authorized", app_id: overrides.appId ?? Number(TRUSTED_RELEASE_AUTH_APP_ID) }] } },
    });
    if (url.endsWith(`/repos/${repo}/pulls/42`)) return response({
      number: 42,
      state: "closed",
      merged: true,
      merge_commit_sha: merged,
      head: { sha: head },
      base: { sha: base, ref: "main", repo: { full_name: repo } },
    });
    if (url.includes(`/repos/${repo}/commits/${head}/statuses`)) return response([
      {
        id: 20,
        state: overrides.latestAuthorizationState ?? "success",
        context: "nusa/release-authorized",
        description: `canonical Audit PASS; pr=42; base=${base}`,
        target_url: `https://github.com/${repo}/actions/runs/${runId}`,
        updated_at: "2026-09-15T12:00:00Z",
        creator: { login: "nusa-release-authority[bot]" },
      },
      {
        id: 10,
        state: "success",
        context: "nusa/release-authorized",
        description: `canonical Audit PASS; pr=42; base=${base}`,
        target_url: `https://github.com/${repo}/actions/runs/${runId}`,
        updated_at: "2026-09-15T11:00:00Z",
        creator: { login: "nusa-release-authority[bot]" },
      },
    ]);
    if (url.endsWith(`/repos/${repo}/actions/runs/${runId}`)) return response({
      id: runId,
      name: "Autopilot Deterministic Audit Release",
      path: ".github/workflows/autopilot-deterministic-audit-release.yml",
      event: "repository_dispatch",
      status: "completed",
      conclusion: "success",
      repository: { full_name: repo },
    });
    if (url.includes(`/repos/${repo}/actions/runs/${runId}/jobs`)) return response({ jobs: [
      { name: "audit", conclusion: "success" },
      { name: "release", conclusion: overrides.releaseJobConclusion ?? "success" },
    ] });
    if (url.endsWith(`/repos/${repo}/commits/${merged}`)) return response({ sha: merged, parents: [{ sha: base }, { sha: head }] });
    if (url.includes(`/repos/${repo}/actions/runs?head_sha=${merged}`)) return response({ workflow_runs: [
      { name: "CI", path: ".github/workflows/ci.yml", head_sha: merged, status: "completed", conclusion: "success" },
      ...(overrides.convergence === false ? [] : [{ name: "Deployment Convergence Receipt", path: ".github/workflows/deployment-convergence-receipt.yml", head_sha: merged, status: "completed", conclusion: "success" }]),
    ] });
    return response({ error: "unexpected", url }, 404);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("resolveGithubReleaseCompletion", () => {
  it("returns RELEASE_COMPLETE only after the canonical App-bound merge and exact merged-SHA convergence chain", async () => {
    const f = fixture();
    const result = await resolveGithubReleaseCompletion(42, { token: "read-token", allowedRepository: repo, apiBaseUrl: "https://api.example.test" }, f.fetchImpl);
    assert.equal(result.status, "RELEASE_COMPLETE");
    assert.equal(result.releaseWorkflowRunId, runId);
    assert.equal(result.expectedHeadSha, head);
    assert.equal(result.expectedBaseSha, base);
    assert.equal(result.mergedSha, merged);
    assert.equal(result.productionMutationAllowed, false);
    assert.equal(f.calls.some((url) => url.includes(`/commits/${head}/statuses`)), true);
    assert.equal(f.calls.some((url) => url.includes(`/actions/runs/${runId}/jobs`)), true);
  });

  it("fails closed when branch protection is not pinned to the trusted release App", async () => {
    const f = fixture({ appId: 999 });
    const result = await resolveGithubReleaseCompletion(42, { token: "read-token", allowedRepository: repo, apiBaseUrl: "https://api.example.test" }, f.fetchImpl);
    assert.equal(result.status, "RELEASE_PROVENANCE_MISSING");
    assert.equal(result.reason, "release-required-app-binding-missing");
    assert.equal(f.calls.some((url) => url.includes("/statuses")), false);
  });

  it("uses the latest exact-context authorization so later invalidation cannot be bypassed by an older success", async () => {
    const f = fixture({ latestAuthorizationState: "error" });
    const result = await resolveGithubReleaseCompletion(42, { token: "read-token", allowedRepository: repo, apiBaseUrl: "https://api.example.test" }, f.fetchImpl);
    assert.equal(result.status, "RELEASE_PROVENANCE_MISSING");
    assert.equal(result.reason, "release-app-authorization-missing-or-invalid");
    assert.equal(f.calls.some((url) => url.includes(`/actions/runs/${runId}/jobs`)), false);
  });

  it("does not equate outer workflow success with Release when the release job was skipped", async () => {
    const f = fixture({ releaseJobConclusion: "skipped" });
    const result = await resolveGithubReleaseCompletion(42, { token: "read-token", allowedRepository: repo, apiBaseUrl: "https://api.example.test" }, f.fetchImpl);
    assert.equal(result.status, "NOT_RELEASED");
  });

  it("reports CONVERGENCE_INCOMPLETE when canonical Release exists but merged-SHA convergence receipt is absent", async () => {
    const f = fixture({ convergence: false });
    const result = await resolveGithubReleaseCompletion(42, { token: "read-token", allowedRepository: repo, apiBaseUrl: "https://api.example.test" }, f.fetchImpl);
    assert.equal(result.status, "CONVERGENCE_INCOMPLETE");
  });

  it("never accepts caller-supplied Release evidence and fails closed without its own GitHub read credential", async () => {
    const result = await resolveGithubReleaseCompletion(42, { allowedRepository: repo });
    assert.equal(result.status, "RELEASE_PROVENANCE_MISSING");
    assert.equal(result.reason, "release-github-token-not-configured");
  });
});
