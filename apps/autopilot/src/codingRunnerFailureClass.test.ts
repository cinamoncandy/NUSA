import test from "node:test";
import assert from "node:assert/strict";
import { classifyCodingRunnerFailure } from "./codingRunnerFailureClass";

const cases: ReadonlyArray<readonly [string, string, string, boolean]> = [
  ["CODING_RUNNER_LIVE_AUTHORITY_FORBIDDEN", "AUTHORITY_VIOLATION", "STOP", false],
  ["CODING_PROPOSAL_AUTHORITY_SURFACE_FORBIDDEN", "AUTHORITY_VIOLATION", "STOP", false],
  ["WORKERS_AI_RATE_LIMITED", "PROVIDER_CAPACITY", "WAIT_FOR_PROVIDER", false],
  ["CODING_RUNNER_WORKFLOW_RUN_UNVERIFIED", "EVIDENCE_UNVERIFIED", "RETRY_BOUNDED", true],
  ["CODING_RUNNER_WORKFLOW_HEAD_MISMATCH", "EVIDENCE_MISMATCH", "REDISPATCH_FRESH_EVIDENCE", false],
  ["CODING_RUNNER_WORKFLOW_NOT_SUCCESSFUL", "EVIDENCE_MISMATCH", "REDISPATCH_FRESH_EVIDENCE", false],
  ["SANDBOX_PATCH_FORBIDDEN_AUTHORITY_SURFACE", "AUTHORITY_VIOLATION", "STOP", false],
  ["CODING_PUBLISH_AUTHORITY_SURFACE_FORBIDDEN", "AUTHORITY_VIOLATION", "STOP", false],
  ["CODING_EDIT_CONTEXT_PATH_MISMATCH", "PROPOSAL_REJECTED", "REGENERATE_PROPOSAL", true],
  ["CODING_PUBLISH_STALE_HEAD_SUPPRESSED", "EVIDENCE_MISMATCH", "REDISPATCH_FRESH_EVIDENCE", false],
  ["WORKERS_AI_MODEL_INVALID", "REQUEST_INVALID", "STOP", false],
  ["FUTURE_REASON_UNVERIFIED", "UNKNOWN", "STOP", false],
  ["FUTURE_REASON_MISMATCH", "UNKNOWN", "STOP", false],
  ["CODING_RUNNER_HEAD_SHA_INVALID", "REQUEST_INVALID", "STOP", false],
  ["WORKERS_AI_CODING_ENGINE_FAILED", "PROVIDER_FAILURE", "RETRY_BOUNDED", true],
  ["CODING_EDIT_ANCHOR_NOT_FOUND", "PROPOSAL_REJECTED", "REGENERATE_PROPOSAL", true],
  ["SANDBOX_PATCH_APPLY_CHECK_FAILED", "PROPOSAL_REJECTED", "REGENERATE_PROPOSAL", true],
];

for (const [code, failureClass, recovery, retryable] of cases) {
  test(`classifies ${code}`, () => {
    assert.deepEqual({ ...classifyCodingRunnerFailure(code) }, { failureClass, recovery, retryable });
  });
}

test("unknown or non-string reasons fail closed", () => {
  for (const value of ["", "SOMETHING_NEW", undefined, null, 42]) {
    assert.deepEqual({ ...classifyCodingRunnerFailure(value) }, { failureClass: "UNKNOWN", recovery: "STOP", retryable: false });
  }
});

test("an authority violation is never retryable even when it also looks like an invalid request", () => {
  assert.equal(classifyCodingRunnerFailure("CODING_RUNNER_AI_AUTHORITY_INVALID").retryable, false);
  assert.equal(classifyCodingRunnerFailure("CODING_RUNNER_AI_AUTHORITY_INVALID").failureClass, "AUTHORITY_VIOLATION");
});
