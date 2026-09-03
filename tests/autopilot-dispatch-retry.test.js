const assert = require("node:assert/strict");
const test = require("node:test");
const {
  dispatchWithRetry,
  transientStatus,
  assertGithubRunnerWorkspaceClean,
  filterGithubRunnerWorkspacePaths,
} = require("../scripts/autopilot-dispatch-retry.js");

const request = Object.freeze({
  kind: "REPOSITORY_AUTOPILOT",
  repository: "cinamoncandy/NUSA",
  headSha: "a".repeat(40),
  workflowRunId: 123,
  reason: "continue-from:ci_succeeded",
  executionId: "github:execution-1283",
  dedupeKey: "ci:1283:aaa",
  mutationAllowed: false,
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
});

function response(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function oidcSuccess() {
  return response(200, { value: "oidc-test-value" });
}

test("classifies only 429 and 5xx as retryable HTTP statuses", () => {
  assert.equal(transientStatus(429), true);
  assert.equal(transientStatus(500), true);
  assert.equal(transientStatus(503), true);
  assert.equal(transientStatus(400), false);
  assert.equal(transientStatus(404), false);
});

test("retries transient OIDC and runner failures with bounded exponential backoff", async () => {
  const calls = [];
  const waits = [];
  let now = 1000;
  const result = await dispatchWithRetry({
    request,
    url: "https://runner.example.test/coding/execute",
    oidcRequestUrl: "https://oidc.example.test/token",
    oidcRequestToken: "oidc-request-test",
    maxAttempts: 3,
    baseBackoffMs: 10,
    now: () => now,
    sleep: async (milliseconds) => waits.push(milliseconds),
    fetchImpl: async (url) => {
      calls.push(url);
      if (calls.length === 1) return response(503);
      if (calls.length === 2 || calls.length === 4) return oidcSuccess();
      if (calls.length === 3) return response(502);
      return response(200, { status: "EXECUTION_ACCEPTED" });
    },
  });
  assert.equal(result.status, "DISPATCHED");
  assert.equal(result.summary.attempts, 3);
  assert.equal(result.summary.retries, 2);
  assert.deepEqual(waits, [10, 20]);
  assert.deepEqual(result.attempts.map((attempt) => attempt.decision), ["RETRY", "RETRY", "DISPATCHED"]);
  assert.deepEqual(result.attempts.map((attempt) => attempt.http_class), ["5xx", "5xx", "2xx"]);
});


test("does not retry malformed successful OIDC responses", async () => {
  let calls = 0;
  const result = await dispatchWithRetry({
    request,
    url: "https://runner.example.test/coding/execute",
    oidcRequestUrl: "https://oidc.example.test/token",
    oidcRequestToken: "oidc-request-test",
    sleep: async () => { throw new Error("unexpected retry"); },
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => { throw new Error("malformed"); } };
    },
  });
  assert.equal(result.status, "FAILED_CLOSED");
  assert.equal(result.reason, "github-oidc-token-missing");
  assert.equal(result.summary.attempts, 1);
  assert.equal(calls, 1);
});
test("does not retry deterministic runner rejection", async () => {
  let calls = 0;
  const result = await dispatchWithRetry({
    request,
    url: "https://runner.example.test/coding/execute",
    oidcRequestUrl: "https://oidc.example.test/token",
    oidcRequestToken: "oidc-request-test",
    sleep: async () => { throw new Error("unexpected retry"); },
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? oidcSuccess() : response(400);
    },
  });
  assert.equal(result.status, "FAILED_CLOSED");
  assert.equal(result.reason, "external-coding-runner-rejected-request");
  assert.equal(result.summary.attempts, 1);
  assert.equal(calls, 2);
  assert.equal(result.attempts[0].decision, "FAILED_CLOSED");
});

test("bounds repeated transient rejection and closes without mutation", async () => {
  const waits = [];
  let calls = 0;
  const result = await dispatchWithRetry({
    request,
    url: "https://runner.example.test/coding/execute",
    oidcRequestUrl: "https://oidc.example.test/token",
    oidcRequestToken: "oidc-request-test",
    baseBackoffMs: 5,
    sleep: async (milliseconds) => waits.push(milliseconds),
    fetchImpl: async () => {
      calls += 1;
      return calls % 2 === 1 ? oidcSuccess() : response(502);
    },
  });
  assert.equal(result.status, "FAILED_CLOSED");
  assert.equal(result.summary.attempts, 3);
  assert.equal(result.summary.retries, 2);
  assert.equal(result.summary.failedClosed, 1);
  assert.deepEqual(waits, [5, 10]);
  assert.equal(calls, 6);
  assert.equal(result.attempts.at(-1).decision, "FAILED_CLOSED");
});

test("records duplicate suppression as no action without retry", async () => {
  let calls = 0;
  const result = await dispatchWithRetry({
    request,
    url: "https://runner.example.test/coding/execute",
    oidcRequestUrl: "https://oidc.example.test/token",
    oidcRequestToken: "oidc-request-test",
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? oidcSuccess() : response(202, { status: "DUPLICATE_EXECUTION_SUPPRESSED" });
    },
  });
  assert.equal(result.status, "NO_ACTION");
  assert.equal(result.summary.noAction, 1);
  assert.equal(result.attempts[0].decision, "NO_ACTION");
  assert.equal(calls, 2);
});

test("allows only this workflow's generated artifacts before patch validation", () => {
  assert.doesNotThrow(() => assertGithubRunnerWorkspaceClean([
    "?? artifacts/autopilot-execution/repository-dispatch.json",
    "?? artifacts/autopilot-execution/coding-runner-request.json",
  ].join("\n")));
  assert.doesNotThrow(() => assertGithubRunnerWorkspaceClean(""));
  assert.deepEqual(
    filterGithubRunnerWorkspacePaths([
      ".nusa-autopilot.patch",
      "artifacts/autopilot-execution/repository-dispatch.json",
      "apps/autopilot/src/codingRunner.ts",
    ]),
    ["apps/autopilot/src/codingRunner.ts"],
  );
});

test("still rejects tracked or unrelated dirty workspace entries", () => {
  for (const status of [
    " M apps/autopilot/src/codingRunner.ts",
    "?? .nusa-autopilot.patch",
    "?? artifacts/autopilot-execution/unexpected.txt",
    "?? artifacts/other.json",
    " M artifacts/autopilot-execution/repository-dispatch.json",
  ]) {
    assert.throws(
      () => assertGithubRunnerWorkspaceClean(status),
      /CODING_RUNTIME_WORKSPACE_DIRTY/,
    );
  }
});
