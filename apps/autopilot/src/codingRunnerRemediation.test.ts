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

test("authority, unknown, stale evidence and capacity fail closed without remediation", () => {
  for (const reason of [
    "CODING_RUNNER_LIVE_AUTHORITY_FORBIDDEN",
    "SOMETHING_NEW",
    "CODING_PUBLISH_STALE_HEAD_SUPPRESSED",
    "WORKERS_AI_RATE_LIMITED",
  ]) {
    const result = decideCodingRunnerNoAction(reason, 0, 2);
    assert.equal(result.outcome, "FAILED_CLOSED");
    assert.equal(result.retryable, false);
  }
});

test("only explicit proposal failures can enter remediation", () => {
  assert.equal(decideCodingRunnerNoAction("CODING_PROPOSAL_REPEATED", 0, 2).retryable, false);
  assert.equal(decideCodingRunnerNoAction("SANDBOX_PATCH_FUTURE_UNKNOWN", 0, 2).retryable, false);
  assert.equal(decideCodingRunnerNoAction("CODING_PROPOSAL_JSON_INVALID", 0, 2).retryable, true);
  assert.equal(decideCodingRunnerNoAction("SANDBOX_PATCH_APPLY_CHECK_FAILED", 0, 2).retryable, true);
});

test("valid no-action requires an explicit successful abstention reason", () => {
  const result = decideCodingRunnerNoAction("NO_ACTION_WARRANTED", 0, 2);
  assert.equal(result.outcome, "VALID_NO_ACTION");
  assert.equal(result.retryable, false);
});

test("invalid retry budget fails closed", () => {
  assert.throws(() => decideCodingRunnerNoAction("CODING_EDIT_ANCHOR_NOT_FOUND", 0, 4), /CODING_REMEDIATION_ATTEMPT_LIMIT_INVALID/);
});
