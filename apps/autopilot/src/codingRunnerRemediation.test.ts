import test from "node:test";
import assert from "node:assert/strict";
import { decideCodingRunnerNoAction } from "./codingRunnerRemediation";

test("actionable proposal failure is failed remediation and bounded retryable", () => {
  assert.deepEqual(
    { ...decideCodingRunnerNoAction("CODING_EDIT_ANCHOR_NOT_FOUND", 0, 2) },
    {
      outcome: "FAILED_TO_REMEDIATE",
      failureClass: "PROPOSAL_REJECTED",
      recovery: "REGENERATE_PROPOSAL",
      retryable: true,
      attempt: 0,
      maxAttempts: 2,
    },
  );
});

test("retry budget exhaustion remains failed remediation but cannot retry", () => {
  const result = decideCodingRunnerNoAction("WORKERS_AI_CODING_ENGINE_FAILED", 2, 2);
  assert.equal(result.outcome, "FAILED_TO_REMEDIATE");
  assert.equal(result.retryable, false);
});

test("authority, unknown, stale evidence and unknown capacity fail closed without remediation", () => {
  for (const reason of [
    "CODING_RUNNER_LIVE_AUTHORITY_FORBIDDEN",
    "SOMETHING_NEW",
    "CODING_PUBLISH_STALE_HEAD_SUPPRESSED",
    "WORKERS_AI_RATE_LIMITED",
    "PROVIDER_CAPACITY_STATE_UNAVAILABLE",
  ]) {
    const result = decideCodingRunnerNoAction(reason, 0, 2);
    assert.equal(result.outcome, "FAILED_CLOSED");
    assert.equal(result.retryable, false);
  }
});

test("canonical proposal allowlist is admitted but repeated and future prefixes fail closed", () => {
  for (const reason of [
    "CODING_PROPOSAL_FAILED_CLOSED",
    "CODING_PROPOSAL_INVALID",
    "CODING_PROPOSAL_TOO_LARGE",
    "CODING_PROPOSAL_UNAVAILABLE",
    "SANDBOX_BUILD_FAILED",
    "SANDBOX_PATCH_FILE_COUNT_INVALID",
    "SANDBOX_PATCH_REQUIRED",
    "SANDBOX_PATCH_TOO_LARGE",
  ]) {
    assert.equal(decideCodingRunnerNoAction(reason, 0, 2).retryable, true, reason);
  }
  assert.equal(decideCodingRunnerNoAction("CODING_PROPOSAL_REPEATED", 0, 2).retryable, false);
  assert.equal(decideCodingRunnerNoAction("SANDBOX_PATCH_FUTURE_UNKNOWN", 0, 2).retryable, false);
});

test("unverified GitHub lookup retries only with transient HTTP evidence", () => {
  for (const reason of ["CODING_RUNNER_HEAD_SHA_UNVERIFIED", "CODING_RUNNER_WORKFLOW_RUN_UNVERIFIED"]) {
    assert.equal(decideCodingRunnerNoAction(reason, 0, 2, 503).retryable, true, reason);
    assert.equal(decideCodingRunnerNoAction(reason, 0, 2, 429).retryable, true, reason);
    assert.equal(decideCodingRunnerNoAction(reason, 0, 2, 401).retryable, false, reason);
    assert.equal(decideCodingRunnerNoAction(reason, 0, 2, 404).retryable, false, reason);
    assert.equal(decideCodingRunnerNoAction(reason, 0, 2).retryable, false, reason);
  }
  assert.equal(decideCodingRunnerNoAction("CODING_RUNNER_WORKFLOW_NOT_COMPLETED", 0, 2).retryable, true);
});

test("concrete transient provider failures are retryable only with bounded evidence", () => {
  assert.equal(decideCodingRunnerNoAction("GITHUB_MODELS_CODING_HTTP_503", 0, 2).retryable, true);
  assert.equal(decideCodingRunnerNoAction("coding-engine-request-failed", 0, 2, 503).retryable, true);
  assert.equal(decideCodingRunnerNoAction("coding-engine-request-failed", 0, 2, 400).retryable, false);
});

test("valid no-action requires an explicit successful abstention reason", () => {
  const result = decideCodingRunnerNoAction("NO_ACTION_WARRANTED", 0, 2);
  assert.equal(result.outcome, "VALID_NO_ACTION");
  assert.equal(result.retryable, false);
});

test("invalid retry budget fails closed", () => {
  assert.throws(() => decideCodingRunnerNoAction("CODING_EDIT_ANCHOR_NOT_FOUND", 0, 4), /CODING_REMEDIATION_ATTEMPT_LIMIT_INVALID/);
});
