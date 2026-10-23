"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { GITHUB_TOOL_DEFINITIONS, callGithubReadTool } = require("../github-read");

const TOKEN = "github-read-only-test-token-12345678901234567890";

function response(payload, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => payload }; }

function fixture(calls) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    assert.equal(init.method, "GET");
    const parsed = new URL(String(url));
    if (parsed.pathname === "/repos/cinamoncandy/NUSA/") return response({ full_name: "cinamoncandy/NUSA", default_branch: "main" });
    if (parsed.pathname === "/repos/cinamoncandy/NUSA/branches/main") return response({ commit: { sha: "a".repeat(40) } });
    if (parsed.pathname === "/repos/cinamoncandy/NUSA/pulls") return response([{ number: 7, title: "safe", head: { ref: "fix/safe" }, base: { ref: "main" }, draft: false, html_url: "https://github.com/cinamoncandy/NUSA/pull/7" }]);
    if (parsed.pathname === "/repos/cinamoncandy/NUSA/actions/runs") return response({ workflow_runs: [{ name: "ci", event: "pull_request", status: "completed", conclusion: "success", head_branch: "fix/safe", head_sha: "b".repeat(40), html_url: "https://github.com/cinamoncandy/NUSA/actions/runs/1" }] });
    return response({}, 404);
  };
}

test("GitHub inventory is read-only only", () => {
  assert.deepEqual(GITHUB_TOOL_DEFINITIONS.map((tool) => tool.name), ["github_repo_status", "github_pull_requests", "github_ci_runs"]);
  assert.ok(GITHUB_TOOL_DEFINITIONS.every((tool) => tool.annotations.readOnlyHint && !tool.annotations.destructiveHint));
  assert.ok(!GITHUB_TOOL_DEFINITIONS.some((tool) => /create|update|delete|merge|push|dispatch/i.test(tool.name)));
});

test("GitHub adapter is GET-only, repo-bound, and preserves zero authority", async () => {
  const calls = [];
  const fetchImpl = fixture(calls);
  const status = await callGithubReadTool("github_repo_status", { token: TOKEN, fetchImpl, now: () => 0 });
  assert.equal(status.repository, "cinamoncandy/NUSA");
  assert.equal(status.mainSha, "a".repeat(40));
  assert.equal(status.liveAuthority, "NONE");
  assert.equal(status.productionMutationAllowed, false);
  assert.equal(status.aiAuthority, "ZERO_AUTHORITY");
  assert.equal((await callGithubReadTool("github_pull_requests", { token: TOKEN, fetchImpl, now: () => 0 })).pullRequests[0].number, 7);
  assert.equal((await callGithubReadTool("github_ci_runs", { token: TOKEN, fetchImpl, now: () => 0 })).runs[0].conclusion, "success");
  assert.ok(calls.every((call) => call.init.method === "GET"));
  assert.ok(calls.every((call) => call.url.startsWith("https://api.github.com/repos/cinamoncandy/NUSA/")));
});

test("GitHub adapter fails closed without credential or for unknown tools", async () => {
  await assert.rejects(() => callGithubReadTool("github_repo_status", { token: "short", fetchImpl: fixture([]) }), /UNAUTHORIZED/);
  await assert.rejects(() => callGithubReadTool("github_write", { token: TOKEN, fetchImpl: fixture([]) }), /UNKNOWN_TOOL/);
});
