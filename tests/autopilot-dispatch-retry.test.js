const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  dispatchWithRetry,
  transientStatus,
  assertBoundedPatch,
  proposalFailureCode,
  providerRateLimitCode,
  readDispatchRequest,
  assertGithubRunnerWorkspaceClean,
  filterGithubRunnerWorkspacePaths,
  boundedWorkerFailureEvidence,
  boundedProposalContext,
  executeGithubActionsRunner,
  MAX_RETRY_DELAY_MS,
  retryHint,
  MAX_REPORTED_QUOTA_RETRY_DELAY_MS,
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

function response(status, body = {}, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: async () => body,
  };
}

function oidcSuccess() {
  return response(200, { value: "oidc-test-value" });
}

async function withOidcEnvironment(run) {
  const previousUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const previousToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL = "https://oidc.example.test/token";
  process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "oidc-request-test";
  try {
    return await run();
  } finally {
    if (previousUrl === undefined) delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    else process.env.ACTIONS_ID_TOKEN_REQUEST_URL = previousUrl;
    if (previousToken === undefined) delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    else process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = previousToken;
  }
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
  const now = 1000;
  const result = await dispatchWithRetry({
    request,
    url: "https://runner.example.test/coding/execute",
    oidcRequestUrl: "https://oidc.example.test/token",
    oidcRequestToken: "oidc-request-test",
    maxAttempts: 3,
    baseBackoffMs: 10,
    jitter: () => 0.5,
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
    jitter: () => 0.5,
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

test("classifies only bounded provider rate-limit reasons", () => {
  assert.equal(providerRateLimitCode("RATE_LIMITED"), "RATE_LIMITED");
  assert.equal(providerRateLimitCode("WORKERS_AI_DAILY_QUOTA_EXHAUSTED"), "WORKERS_AI_DAILY_QUOTA_EXHAUSTED");
  assert.equal(providerRateLimitCode("WORKERS_AI_RATE_LIMITED"), "WORKERS_AI_RATE_LIMITED");
  assert.equal(providerRateLimitCode("WAITING_PROVIDER_CAPACITY"), "PROVIDER_RATE_LIMITED");
  assert.equal(providerRateLimitCode("provider unavailable"), null);
  assert.equal(providerRateLimitCode("WORKERS_AI_RATE_LIMITED secret=unexpected"), null);
});

test("uses a valid Retry-After hint before bounded retry backoff", async () => {
  const waits = [];
  let runnerCalls = 0;
  const result = await dispatchWithRetry({
    request,
    url: "https://runner.example.test/coding/execute",
    oidcRequestUrl: "https://oidc.example.test/token",
    oidcRequestToken: "oidc-request-test",
    maxAttempts: 3,
    baseBackoffMs: 10,
    jitter: () => 0.5,
    sleep: async (milliseconds) => waits.push(milliseconds),
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.startsWith("https://oidc.example.test/token")) return oidcSuccess();
      runnerCalls += 1;
      return runnerCalls === 1
        ? response(429, { error: "RATE_LIMITED" }, { "Retry-After": "2" })
        : response(200, { status: "EXECUTION_ACCEPTED" });
    },
  });
  assert.equal(result.status, "DISPATCHED");
  assert.deepEqual(waits, [2_000]);
  assert.equal(result.rateLimitEvents.length, 1);
  assert.equal(result.rateLimitEvents[0].retrySource, "retry-after-header");
});

test("falls back to bounded jitter when Retry-After is malformed or missing", async () => {
  const waits = [];
  let runnerCalls = 0;
  const result = await dispatchWithRetry({
    request,
    url: "https://runner.example.test/coding/execute",
    oidcRequestUrl: "https://oidc.example.test/token",
    oidcRequestToken: "oidc-request-test",
    maxAttempts: 3,
    baseBackoffMs: 5,
    jitter: () => 0.5,
    sleep: async (milliseconds) => waits.push(milliseconds),
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.startsWith("https://oidc.example.test/token")) return oidcSuccess();
      runnerCalls += 1;
      if (runnerCalls === 1) return response(429, { error: "RATE_LIMITED" }, { "Retry-After": "malformed" });
      return response(200, { status: "EXECUTION_ACCEPTED" });
    },
  });
  assert.equal(result.status, "DISPATCHED");
  assert.deepEqual(waits, [5]);

  const exhausted = await dispatchWithRetry({
    request,
    url: "https://runner.example.test/coding/execute",
    oidcRequestUrl: "https://oidc.example.test/token",
    oidcRequestToken: "oidc-request-test",
    maxAttempts: 3,
    baseBackoffMs: 5,
    jitter: () => 0.5,
    sleep: async (milliseconds) => waits.push(milliseconds),
    fetchImpl: async (url) => String(url).startsWith("https://oidc.example.test/token")
      ? oidcSuccess()
      : response(429, { error: "RATE_LIMITED" }),
  });
  assert.equal(exhausted.status, "BLOCKED_RATE_LIMIT");
  assert.equal(exhausted.reason, "RATE_LIMITED");
  assert.equal(exhausted.provider, "external-coding-runner");
  assert.equal(exhausted.rateLimitEvents.length, 3);
  assert.equal(exhausted.retrySource, "bounded-exponential-backoff-jitter");
  assert.deepEqual(waits, [5, 5, 10]);
});

test("clamps excessive Retry-After values to the bounded retry ceiling", () => {
  const hint = retryHint(
    response(429, { error: "RATE_LIMITED" }, { "Retry-After": "999999" }),
    { error: "RATE_LIMITED" },
    1_700_000_000_000,
  );
  assert.deepEqual(hint, { delayMs: MAX_RETRY_DELAY_MS, source: "retry-after-header" });
});

test("normalizes a non-2xx worker rate-limit stop into waiting without proposal retries", async () => {
  await withOidcEnvironment(async () => {
    let proposalCalls = 0;
    let publishCalls = 0;
    const result = await executeGithubActionsRunner(
      request,
      "https://runner.example.test/coding/execute",
      async (url) => {
        const value = String(url);
        if (value.startsWith("https://oidc.example.test/token")) return oidcSuccess();
        if (value.endsWith("/coding/propose")) {
          proposalCalls += 1;
          return response(409, { status: "CODING_PROPOSAL_FAILED_CLOSED", error: "WORKERS_AI_DAILY_QUOTA_EXHAUSTED" });
        }
        if (value.endsWith("/coding/publish")) {
          publishCalls += 1;
          throw new Error("publish must not run");
        }
        throw new Error("unexpected URL " + value);
      },
      {
        now: () => 1_000,
        jitter: () => 0.5,
      },
    );
    assert.equal(result.status, "WAITING_RATE_LIMIT");
    assert.equal(result.reason, "WAITING_RATE_LIMIT");
    assert.equal(result.proposalAttempts, 1);
    assert.equal(result.proposalRetries, 0);
    assert.equal(result.codeChanged, false);
    assert.equal(result.blockedRateLimit, false);
    assert.equal(result.summary.blockedRateLimit, 0);
    assert.equal(result.summary.failedClosed, 0);
    assert.equal(result.provider, "workers-ai");
    assert.equal(result.lastRateLimitAt, 1000);
    assert.equal(result.nextRetryAt, 2_000);
    assert.equal(result.retrySource, "bounded-exponential-backoff-jitter");
    assert.equal(result.stopReason, "WORKERS_AI_DAILY_QUOTA_EXHAUSTED");
    assert.equal(proposalCalls, 1);
    assert.equal(publishCalls, 0);
  });
});

test("normalizes a non-2xx shared provider-capacity stop without failing the consumer", async () => {
  await withOidcEnvironment(async () => {
    let proposalCalls = 0;
    const result = await executeGithubActionsRunner(
      request,
      "https://runner.example.test/coding/execute",
      async (url) => {
        const value = String(url);
        if (value.startsWith("https://oidc.example.test/token")) return oidcSuccess();
        proposalCalls += 1;
        // Exact shape apps/autopilot/src/worker.ts handleCodingProposal returns while a shared
        // provider wait is active: no stopReason or lastFailure, only error + providerStopReason.
        return response(409, {
          accepted: false,
          status: "CODING_PROPOSAL_FAILED_CLOSED",
          error: "WAITING_PROVIDER_CAPACITY",
          providerStopReason: "WAITING_PROVIDER_CAPACITY",
          nextRetryAt: 1_700_000_100_000,
          liveAuthority: "NONE",
          productionMutationAllowed: false,
          aiAuthority: "ZERO_AUTHORITY",
        });
      },
      { now: () => 1_700_000_000_000, sleep: async () => { throw new Error("must not retry"); } },
    );
    assert.equal(result.status, "WAITING_RATE_LIMIT");
    assert.equal(result.reason, "WAITING_RATE_LIMIT");
    assert.equal(result.summary.failedClosed, 0);
    assert.equal(result.attempts[0].decision, "NO_ACTION");
    assert.equal(result.stopReason, "WAITING_PROVIDER_CAPACITY");
    // The shared wait's absolute resume time (~100s out) is reported, not the 60s local-retry cap.
    assert.equal(result.rateLimitEvents?.[0]?.nextRetryAt ?? result.nextRetryAt, 1_700_000_100_000);
    assert.equal(proposalCalls, 1);
  });
});

test("preserves a worker WAITING_RATE_LIMIT stop and suppresses duplicate dispatch", async () => {
  await withOidcEnvironment(async () => {
    const now = 1_700_000_000_000;
    const waits = [];
    let runnerCalls = 0;
    const result = await executeGithubActionsRunner(
      request,
      "https://runner.example.test/coding/execute",
      async (url) => {
        const value = String(url);
        if (value.startsWith("https://oidc.example.test/token")) return oidcSuccess();
        runnerCalls += 1;
        return response(202, {
          status: "WAITING_RATE_LIMIT",
          provider: "workers-ai",
          stopReason: "WORKERS_AI_RATE_LIMITED",
          lastFailure: "WORKERS_AI_RATE_LIMITED",
          nextRetryAt: now + 5_000,
          resumeCondition: "provider-capacity-and-exact-head-revalidation",
        });
      },
      { now: () => now, sleep: async (milliseconds) => waits.push(milliseconds) },
    );
    assert.equal(result.status, "WAITING_RATE_LIMIT");
    assert.equal(result.reason, "WAITING_RATE_LIMIT");
    assert.equal(result.nextRetryAt, now + 5_000);
    assert.equal(result.stopReason, "WORKERS_AI_RATE_LIMITED");
    assert.equal(result.resumeCondition, "provider-capacity-and-exact-head-revalidation");
    assert.deepEqual(result.attempts.map((attempt) => attempt.decision), ["NO_ACTION"]);
    assert.deepEqual(waits, []);
    assert.equal(runnerCalls, 1);
  });
});

test("reports the real resume time when a later execution is stopped by an already-recorded provider wait", async () => {
  await withOidcEnvironment(async () => {
    const now = Date.parse("2026-09-23T11:05:37.000Z");
    const nextUtcDay = Date.parse("2026-09-24T00:00:00.000Z");
    const result = await executeGithubActionsRunner(
      request,
      "https://runner.example.test/coding/execute",
      async (url) => {
        const value = String(url);
        if (value.startsWith("https://oidc.example.test/token")) return oidcSuccess();
        return response(202, {
          status: "WAITING_RATE_LIMIT",
          provider: "workers-ai",
          reason: "WAITING_PROVIDER_CAPACITY",
          stopReason: "WAITING_PROVIDER_CAPACITY",
          lastFailure: "WAITING_PROVIDER_CAPACITY",
          nextRetryAt: nextUtcDay,
          resumeCondition: "provider-capacity-and-exact-head-revalidation",
        });
      },
      { now: () => now, sleep: async () => { throw new Error("must not sleep"); } },
    );
    assert.equal(result.status, "WAITING_RATE_LIMIT");
    assert.equal(result.stopReason, "WAITING_PROVIDER_CAPACITY");
    // A wait already recorded by a different execution/task is just as long-lived as the
    // original daily-quota stop; it must not be truncated back down to the 60s ceiling.
    assert.equal(result.nextRetryAt, nextUtcDay);
    assert.ok(result.nextRetryAt - now > MAX_RETRY_DELAY_MS);
  });
});

test("reports the real next-UTC-day resume time for a daily-quota stop instead of the 60s retry ceiling", async () => {
  await withOidcEnvironment(async () => {
    const now = Date.parse("2026-09-23T10:53:36.040Z");
    const nextUtcDay = Date.parse("2026-09-24T00:00:00.000Z");
    const waits = [];
    let runnerCalls = 0;
    const result = await executeGithubActionsRunner(
      request,
      "https://runner.example.test/coding/execute",
      async (url) => {
        const value = String(url);
        if (value.startsWith("https://oidc.example.test/token")) return oidcSuccess();
        runnerCalls += 1;
        return response(202, {
          status: "WAITING_RATE_LIMIT",
          provider: "workers-ai",
          stopReason: "WORKERS_AI_DAILY_QUOTA_EXHAUSTED",
          lastFailure: "WORKERS_AI_DAILY_QUOTA_EXHAUSTED",
          nextRetryAt: nextUtcDay,
          resumeCondition: "provider-capacity-and-exact-head-revalidation",
        });
      },
      { now: () => now, sleep: async (milliseconds) => waits.push(milliseconds) },
    );
    assert.equal(result.status, "WAITING_RATE_LIMIT");
    assert.equal(result.stopReason, "WORKERS_AI_DAILY_QUOTA_EXHAUSTED");
    // The real resume time is ~13h away; it must not be clamped down to the 60s retry ceiling.
    assert.equal(result.nextRetryAt, nextUtcDay);
    assert.ok(result.nextRetryAt - now > MAX_RETRY_DELAY_MS);
    assert.deepEqual(result.attempts.map((attempt) => attempt.decision), ["NO_ACTION"]);
    assert.deepEqual(waits, []);
    assert.equal(runnerCalls, 1);
  });
});

test("prefers the provider's absolute reset timestamp over a relative retryAfterMs when both are present", () => {
  const observedAt = 1_700_000_000_000;
  const absoluteNextRetryAt = observedAt + 50_000_000; // far outside the 60s local retry ceiling
  const hint = retryHint(
    response(409, {}),
    { stopReason: "WORKERS_AI_DAILY_QUOTA_EXHAUSTED", retryAfterMs: 500, nextRetryAt: absoluteNextRetryAt },
    observedAt,
    MAX_REPORTED_QUOTA_RETRY_DELAY_MS,
  );
  assert.deepEqual(hint, { delayMs: absoluteNextRetryAt - observedAt, source: "provider-nextRetryAt" });
});

test("still bounds a generic transient rate limit's reported resume time to the retry ceiling", () => {
  const hint = retryHint(
    response(429, { error: "WORKERS_AI_RATE_LIMITED" }),
    { error: "WORKERS_AI_RATE_LIMITED", nextRetryAt: 1_700_000_000_000 + 999_999_000 },
    1_700_000_000_000,
    MAX_RETRY_DELAY_MS,
  );
  assert.deepEqual(hint, { delayMs: MAX_RETRY_DELAY_MS, source: "provider-nextRetryAt" });
});

test("retries a temporary provider rate limit using provider retry metadata", async () => {
  await withOidcEnvironment(async () => {
    const waits = [];
    let proposalCalls = 0;
    let publishCalls = 0;
    const result = await executeGithubActionsRunner(
      request,
      "https://runner.example.test/coding/execute",
      async (url) => {
        const value = String(url);
        if (value.startsWith("https://oidc.example.test/token")) return oidcSuccess();
        if (value.endsWith("/coding/propose")) {
          proposalCalls += 1;
          if (proposalCalls === 1) return response(429, { error: "WORKERS_AI_RATE_LIMITED", retryAfterMs: 25 });
          return response(200, { status: "PROPOSAL_READY", patch: "valid-patch" });
        }
        if (value.endsWith("/coding/publish")) {
          publishCalls += 1;
          return response(200, { status: "EXECUTION_ACCEPTED", proposalValidated: true, commitSha: "c".repeat(40), pullRequestNumber: 88 });
        }
        throw new Error("unexpected URL " + value);
      },
      {
        validatePatch() { return [{ path: "apps/autopilot/src/example.ts", content: "export const valid = true;\n" }]; },
        sleep: async (milliseconds) => waits.push(milliseconds),
        now: () => 1_000,
        jitter: () => 0.5,
      },
    );
    assert.equal(result.status, "DISPATCHED");
    assert.deepEqual(waits, [25]);
    assert.deepEqual(result.attempts.map((attempt) => attempt.decision), ["RETRY", "DISPATCHED"]);
    assert.equal(result.proposalAttempts, 2);
    assert.equal(result.codeChanged, true);
    assert.equal(proposalCalls, 2);
    assert.equal(publishCalls, 1);
  });
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
    "?? artifacts/",
    "?? artifacts/other.json",
    " M artifacts/autopilot-execution/repository-dispatch.json",
  ]) {
    assert.throws(
      () => assertGithubRunnerWorkspaceClean(status),
      /CODING_RUNTIME_WORKSPACE_DIRTY/,
    );
  }
});

test("rejects forbidden authority-surface patch paths", () => {
  assert.throws(
    () => assertBoundedPatch("diff --git a/apps/autopilot/src/live/broker/order/credential/secret/withdraw/transfer.ts b/apps/autopilot/src/live/broker/order/credential/secret/withdraw/transfer.ts\n+++ b/apps/autopilot/src/live/broker/order/credential/secret/withdraw/transfer.ts\n"),
    /SANDBOX_PATCH_PATH_FORBIDDEN/,
  );
});

test("builds a bounded exact-head retry excerpt around the rejected hunk", () => {
  const source = Array.from({ length: 300 }, (_value, index) => `line-${index + 1}`).join("\n");
  const contextPatch = [
    "diff --git a/apps/autopilot/src/example.ts b/apps/autopilot/src/example.ts",
    "--- a/apps/autopilot/src/example.ts",
    "+++ b/apps/autopilot/src/example.ts",
    "@@ -200,1 +200,1 @@",
    "-line-200",
    "+line-200-updated",
    "",
  ].join("\n");
  const context = boundedProposalContext("apps/autopilot/src/example.ts", source, contextPatch);
  assert.equal(context.path, "apps/autopilot/src/example.ts");
  assert.ok(context.startLine <= 200);
  assert.match(context.content, /line-200/);
  assert.ok(Buffer.byteLength(context.content, "utf8") <= 20_000);
});

test("classifies only bounded proposal validation failures as no-action", () => {
  assert.equal(proposalFailureCode("CODING_PROPOSAL_JSON_INVALID"), "CODING_PROPOSAL_JSON_INVALID");
  assert.equal(proposalFailureCode("SANDBOX_PATCH_APPLY_CHECK_FAILED:128:error: malformed diff"), "SANDBOX_PATCH_APPLY_CHECK_FAILED");
  assert.equal(proposalFailureCode("CODING_RUNTIME_WORKSPACE_DIRTY"), null);
  assert.equal(proposalFailureCode("CODING_PROPOSAL_PATH_FORBIDDEN"), null);
  assert.equal(proposalFailureCode("SANDBOX_PATCH_FORBIDDEN_AUTHORITY_SURFACE"), null);
  assert.equal(proposalFailureCode("CODING_PROPOSAL_JSON_INVALID secret=redacted"), null);
});

test("regenerates an apply-check rejection inside one execution and publishes the repaired patch", async () => {
  await withOidcEnvironment(async () => {
    let proposalCalls = 0;
    let publishCalls = 0;
    let validateCalls = 0;
    const proposalBodies = [];
    const result = await executeGithubActionsRunner(
      request,
      "https://runner.example.test/coding/execute",
      async (url, init = {}) => {
        const value = String(url);
        if (value.startsWith("https://oidc.example.test/token")) return oidcSuccess();
        if (value.endsWith("/coding/propose")) {
          proposalCalls += 1;
          proposalBodies.push(JSON.parse(init.body));
          return response(200, { status: "PROPOSAL_READY", patch: proposalCalls === 1 ? "first-invalid-patch" : "second-valid-patch" });
        }
        if (value.endsWith("/coding/publish")) {
          publishCalls += 1;
          return response(200, {
            status: "EXECUTION_ACCEPTED",
            proposalValidated: true,
            publisher: "github-validated-patch",
            branch: "autopilot/test",
            commitSha: "b".repeat(40),
            pullRequestNumber: 77,
            pullRequestUrl: "https://github.com/cinamoncandy/NUSA/pull/77",
          });
        }
        throw new Error("unexpected URL " + value);
      },
      {
        now: () => 1_000,
        validatePatch(value, patch) {
          validateCalls += 1;
          assert.equal(value.executionId, request.executionId);
          if (validateCalls === 1) throw new Error("SANDBOX_PATCH_APPLY_CHECK_FAILED:128:error: patch failed");
          assert.equal(patch, "second-valid-patch");
          return [{ path: "apps/autopilot/src/example.ts", content: "export const repaired = true;\n" }];
        },
        initialProposalContext() {
          return { path: "apps/autopilot/src/first.ts", startLine: 1, content: "export const first = true;\n" };
        },
        proposalContextForPatch(patch) {
          assert.equal(patch, "first-invalid-patch");
          return {
            path: "apps/autopilot/src/example.ts",
            startLine: 1,
            content: "export const oldValue = true;\n",
          };
        },
      },
    );

    assert.equal(result.status, "DISPATCHED");
    assert.equal(result.proposalAttempts, 2);
    assert.equal(result.proposalRetries, 1);
    assert.equal(result.codeChanged, true);
    assert.equal(result.commitSha, "b".repeat(40));
    assert.equal(result.pullRequestNumber, 77);
    assert.equal(proposalCalls, 2);
    assert.equal(validateCalls, 2);
    assert.equal(publishCalls, 1);
    assert.equal(proposalBodies[0].executionId, request.executionId);
    assert.equal(proposalBodies[1].executionId, request.executionId);
    assert.equal(proposalBodies[1].dedupeKey, request.dedupeKey);
    assert.equal(proposalBodies[1].headSha, request.headSha);
    assert.match(proposalBodies[1].proposalFeedback, /SANDBOX_PATCH_APPLY_CHECK_FAILED/);
    // This asserted proposalContext === undefined, which pinned the defect: attempt 1 was sent
    // with no source excerpt, so the model had to invent the context lines that `git apply --check`
    // compares byte for byte. Attempt 1 now carries a real excerpt like every retry does.
    assert.deepEqual(proposalBodies[0].proposalContext, {
      path: "apps/autopilot/src/first.ts",
      startLine: 1,
      content: "export const first = true;\n",
    });
    assert.deepEqual(proposalBodies[1].proposalContext, {
      path: "apps/autopilot/src/example.ts",
      startLine: 1,
      content: "export const oldValue = true;\n",
    });
    assert.deepEqual(result.attempts.map((entry) => entry.decision), ["RETRY", "DISPATCHED"]);
  });
});

test("bounds repeated apply-check rejection at three proposal attempts", async () => {
  await withOidcEnvironment(async () => {
    let proposalCalls = 0;
    const result = await executeGithubActionsRunner(
      request,
      "https://runner.example.test/coding/execute",
      async (url) => {
        const value = String(url);
        if (value.startsWith("https://oidc.example.test/token")) return oidcSuccess();
        if (value.endsWith("/coding/propose")) {
          proposalCalls += 1;
          return response(200, { status: "PROPOSAL_READY", patch: "invalid-patch-" + proposalCalls });
        }
        throw new Error("publish must not run");
      },
      {
        validatePatch() {
          throw new Error("SANDBOX_PATCH_APPLY_CHECK_FAILED:128:error: patch failed");
        },
      },
    );

    assert.equal(result.status, "NO_ACTION");
    assert.equal(result.reason, "SANDBOX_PATCH_APPLY_CHECK_FAILED");
    assert.equal(result.proposalAttempts, 3);
    assert.equal(result.proposalRetries, 2);
    assert.equal(result.codeChanged, false);
    assert.equal(proposalCalls, 3);
    assert.deepEqual(result.attempts.map((entry) => entry.decision), ["RETRY", "RETRY", "NO_ACTION"]);
  });
});

test("terminates when the AI repeats the same rejected patch", async () => {
  await withOidcEnvironment(async () => {
    let proposalCalls = 0;
    let validateCalls = 0;
    const result = await executeGithubActionsRunner(
      request,
      "https://runner.example.test/coding/execute",
      async (url) => {
        const value = String(url);
        if (value.startsWith("https://oidc.example.test/token")) return oidcSuccess();
        if (value.endsWith("/coding/propose")) {
          proposalCalls += 1;
          return response(200, { status: "PROPOSAL_READY", patch: "same-invalid-patch" });
        }
        throw new Error("publish must not run");
      },
      {
        validatePatch() {
          validateCalls += 1;
          throw new Error("SANDBOX_PATCH_APPLY_CHECK_FAILED:128:error: patch failed");
        },
      },
    );

    assert.equal(result.status, "NO_ACTION");
    assert.equal(result.reason, "CODING_PROPOSAL_REPEATED");
    assert.equal(result.proposalAttempts, 2);
    assert.equal(proposalCalls, 2);
    assert.equal(validateCalls, 1);
  });
});

test("does not retry forbidden authority or path failures", async () => {
  await withOidcEnvironment(async () => {
    let proposalCalls = 0;
    await assert.rejects(
      () => executeGithubActionsRunner(
        request,
        "https://runner.example.test/coding/execute",
        async (url) => {
          const value = String(url);
          if (value.startsWith("https://oidc.example.test/token")) return oidcSuccess();
          if (value.endsWith("/coding/propose")) {
            proposalCalls += 1;
            return response(200, { status: "PROPOSAL_READY", patch: "forbidden-patch" });
          }
          throw new Error("publish must not run");
        },
        {
          validatePatch() {
            throw new Error("SANDBOX_PATCH_PATH_FORBIDDEN:apps/autopilot/src/live/order.ts");
          },
        },
      ),
      /SANDBOX_PATCH_PATH_FORBIDDEN/,
    );
    assert.equal(proposalCalls, 1);
  });
});

test("normalizes a UTF-8 BOM and rejects malformed dispatch events with bounded reasons", () => {
  const eventPath = path.join(os.tmpdir(), `nusa-autopilot-event-${process.pid}-${Date.now()}.json`);
  const previousEventPath = process.env.GITHUB_EVENT_PATH;
  try {
    fs.writeFileSync(eventPath, `\uFEFF${JSON.stringify({ client_payload: {
      kind: "REPOSITORY_AUTOPILOT",
      repository: request.repository,
      head_sha: request.headSha,
      workflow_run_id: request.workflowRunId,
      reason: request.reason,
      execution_id: request.executionId,
      dedupe_key: request.dedupeKey,
    } })}`);
    process.env.GITHUB_EVENT_PATH = eventPath;
    assert.equal(readDispatchRequest().headSha, request.headSha);

    fs.writeFileSync(eventPath, "not-json");
    assert.throws(() => readDispatchRequest(), /GITHUB_EVENT_JSON_INVALID/);
  } finally {
    if (previousEventPath === undefined) delete process.env.GITHUB_EVENT_PATH;
    else process.env.GITHUB_EVENT_PATH = previousEventPath;
    fs.rmSync(eventPath, { force: true });
  }
});


test("preserves only bounded structured Worker workflow evidence", () => {
  const evidence = boundedWorkerFailureEvidence({
    error: "CODING_RUNNER_WORKFLOW_NOT_SUCCESSFUL",
    failureEvidence: {
      code: "CODING_RUNNER_WORKFLOW_NOT_SUCCESSFUL",
      workflowRunId: 35336423782,
      workflowName: "Scheduled Autopilot",
      workflowEvent: "schedule",
      workflowStatus: "completed",
      workflowConclusion: "failure",
      headSha: "b".repeat(40),
      secret: "must-not-propagate",
    },
  }, "https://nusa-autopilot.example/coding/propose", 409);
  assert.deepEqual(evidence, {
    code: "CODING_RUNNER_WORKFLOW_NOT_SUCCESSFUL",
    endpoint: "/coding/propose",
    httpStatus: 409,
    workflowRunId: 35336423782,
    workflowName: "Scheduled Autopilot",
    workflowEvent: "schedule",
    workflowStatus: "completed",
    workflowConclusion: "failure",
    headSha: "b".repeat(40),
  });
  assert.equal(boundedWorkerFailureEvidence({ failureEvidence: { code: "BAD secret" } }, "https://example.test/coding/propose", 409), null);
});
