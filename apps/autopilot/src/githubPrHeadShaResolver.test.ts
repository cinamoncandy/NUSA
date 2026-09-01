import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveOpenPullRequestByHeadSha } from "./githubPrHeadShaResolver";

const HEAD = "a".repeat(40);
const OTHER_HEAD = "b".repeat(40);

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

function config(overrides: Partial<Parameters<typeof resolveOpenPullRequestByHeadSha>[1]> = {}) {
  return { token: "test", allowedRepository: "cinamoncandy/NUSA", ...overrides };
}

describe("resolveOpenPullRequestByHeadSha", () => {
  it("resolves the single open PR whose exact current head matches", async () => {
    const fetchImpl = fakeFetch(200, [{ number: 42, state: "open", head: { sha: HEAD } }]);
    const result = await resolveOpenPullRequestByHeadSha(HEAD, config({ fetchImpl }));
    assert.deepEqual(result, { resolved: true, prNumber: 42, reason: "resolved-unique-open-pr-at-exact-head" });
  });

  it("fails closed when no PR is returned at all", async () => {
    const fetchImpl = fakeFetch(200, []);
    const result = await resolveOpenPullRequestByHeadSha(HEAD, config({ fetchImpl }));
    assert.equal(result.resolved, false);
    assert.equal(result.reason, "no-open-pr-at-exact-head");
  });

  it("fails closed when the only PR containing the commit is closed", () => {
    return resolveOpenPullRequestByHeadSha(HEAD, config({ fetchImpl: fakeFetch(200, [{ number: 1, state: "closed", head: { sha: HEAD } }]) })).then((result) => {
      assert.equal(result.resolved, false);
      assert.equal(result.reason, "no-open-pr-at-exact-head");
    });
  });

  it("fails closed when the PR's current head has moved on from the requested (stale) SHA", async () => {
    const fetchImpl = fakeFetch(200, [{ number: 1, state: "open", head: { sha: OTHER_HEAD } }]);
    const result = await resolveOpenPullRequestByHeadSha(HEAD, config({ fetchImpl }));
    assert.equal(result.resolved, false);
    assert.equal(result.reason, "no-open-pr-at-exact-head");
  });

  it("fails closed when more than one open PR currently has this exact head", async () => {
    const fetchImpl = fakeFetch(200, [
      { number: 1, state: "open", head: { sha: HEAD } },
      { number: 2, state: "open", head: { sha: HEAD } },
    ]);
    const result = await resolveOpenPullRequestByHeadSha(HEAD, config({ fetchImpl }));
    assert.equal(result.resolved, false);
    assert.equal(result.reason, "ambiguous-multiple-open-prs-at-exact-head");
  });

  it("ignores an open PR at a different head while resolving the one at the exact head", async () => {
    const fetchImpl = fakeFetch(200, [
      { number: 1, state: "open", head: { sha: OTHER_HEAD } },
      { number: 2, state: "open", head: { sha: HEAD } },
    ]);
    const result = await resolveOpenPullRequestByHeadSha(HEAD, config({ fetchImpl }));
    assert.deepEqual(result, { resolved: true, prNumber: 2, reason: "resolved-unique-open-pr-at-exact-head" });
  });

  it("fails closed on an invalid head SHA without calling the API", async () => {
    let called = false;
    const fetchImpl = (async () => { called = true; return { ok: true, status: 200, json: async () => [] }; }) as unknown as typeof fetch;
    const result = await resolveOpenPullRequestByHeadSha("not-a-sha", config({ fetchImpl }));
    assert.equal(result.resolved, false);
    assert.equal(result.reason, "head-sha-invalid");
    assert.equal(called, false);
  });

  it("fails closed when no token is configured", async () => {
    const result = await resolveOpenPullRequestByHeadSha(HEAD, config({ token: undefined }));
    assert.equal(result.resolved, false);
    assert.equal(result.reason, "github-token-required");
  });

  it("fails closed on a 401/403 auth rejection", async () => {
    const result = await resolveOpenPullRequestByHeadSha(HEAD, config({ fetchImpl: fakeFetch(403, {}) }));
    assert.equal(result.resolved, false);
    assert.equal(result.reason, "github-api-auth-rejected");
  });

  it("fails closed on a 404 (unknown commit)", async () => {
    const result = await resolveOpenPullRequestByHeadSha(HEAD, config({ fetchImpl: fakeFetch(404, {}) }));
    assert.equal(result.resolved, false);
    assert.equal(result.reason, "github-api-commit-not-found");
  });

  it("fails closed when the fetch itself throws (network error)", async () => {
    const fetchImpl = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    const result = await resolveOpenPullRequestByHeadSha(HEAD, config({ fetchImpl }));
    assert.equal(result.resolved, false);
    assert.equal(result.reason, "github-api-request-failed");
  });

  it("fails closed on a malformed (non-array) response body", async () => {
    const result = await resolveOpenPullRequestByHeadSha(HEAD, config({ fetchImpl: fakeFetch(200, { not: "an array" }) }));
    assert.equal(result.resolved, false);
    assert.equal(result.reason, "github-api-response-invalid");
  });
});
