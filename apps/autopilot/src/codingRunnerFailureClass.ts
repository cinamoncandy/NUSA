/**
 * Fail-closed classification for coding-runner failures. This module is pure: it grants no
 * authority and performs no retry. Only explicit, known reason codes can become retryable.
 */
export type CodingRunnerFailureClass =
  | "AUTHORITY_VIOLATION"
  | "EVIDENCE_UNVERIFIED"
  | "EVIDENCE_MISMATCH"
  | "REQUEST_INVALID"
  | "PROVIDER_CAPACITY"
  | "PROVIDER_FAILURE"
  | "PROPOSAL_REJECTED"
  | "UNKNOWN";

export type CodingRunnerRecovery =
  | "STOP"
  | "WAIT_FOR_PROVIDER"
  | "RETRY_BOUNDED"
  | "REGENERATE_PROPOSAL"
  | "REDISPATCH_FRESH_EVIDENCE";

export interface CodingRunnerFailureClassification {
  readonly failureClass: CodingRunnerFailureClass;
  readonly recovery: CodingRunnerRecovery;
  readonly retryable: boolean;
}

const make = (failureClass: CodingRunnerFailureClass, recovery: CodingRunnerRecovery, retryable: boolean): CodingRunnerFailureClassification =>
  Object.freeze({ failureClass, recovery, retryable });

const CAPACITY = new Set(["WORKERS_AI_DAILY_QUOTA_EXHAUSTED", "WORKERS_AI_RATE_LIMITED", "WAITING_PROVIDER_CAPACITY", "BLOCKED_RATE_LIMIT"]);
const UNVERIFIED = new Set(["CODING_RUNNER_HEAD_SHA_UNVERIFIED", "CODING_RUNNER_WORKFLOW_RUN_UNVERIFIED", "CODING_RUNNER_WORKFLOW_NOT_COMPLETED"]);
const STALE_EVIDENCE = new Set(["CODING_PUBLISH_STALE_HEAD_SUPPRESSED", "CODING_RUNNER_WORKFLOW_NOT_SUCCESSFUL", "CODING_RUNNER_FAILURE_EVIDENCE_INVALID"]);
const PROVIDER = new Set(["WORKERS_AI_CODING_ENGINE_FAILED", "GITHUB_MODELS_CODING_FAILED"]);
const RETRYABLE_PROPOSAL_FAILURES = new Set([
  "CODING_PROPOSAL_PATCH_REQUIRED",
  "CODING_PROPOSAL_SHAPE_INVALID",
  "CODING_PROPOSAL_JSON_INVALID",
  "CODING_PROPOSAL_RESPONSE_INVALID",
  "CODING_EDIT_CONTEXT_REQUIRED",
  "CODING_EDIT_CONTEXT_PATH_MISMATCH",
  "CODING_EDIT_ANCHOR_NOT_FOUND",
  "SANDBOX_PATCH_APPLY_CHECK_FAILED",
  "SANDBOX_PATCH_NORMALIZED_APPLY_CHECK_FAILED",
  "GITHUB_MODELS_CODING_RESPONSE_INVALID",
]);

export function classifyCodingRunnerFailure(reason: unknown, httpStatus?: number): CodingRunnerFailureClassification {
  const code = typeof reason === "string" ? reason.trim() : "";
  if (/AUTHORITY|PRODUCTION_MUTATION/.test(code)) return make("AUTHORITY_VIOLATION", "STOP", false);
  if (code === "PROVIDER_CAPACITY_STATE_UNAVAILABLE") return make("PROVIDER_CAPACITY", "STOP", false);
  if (CAPACITY.has(code)) return make("PROVIDER_CAPACITY", "WAIT_FOR_PROVIDER", false);
  if (UNVERIFIED.has(code)) return make("EVIDENCE_UNVERIFIED", "RETRY_BOUNDED", true);
  if (STALE_EVIDENCE.has(code) || /^CODING_RUNNER_[A-Z_]+_MISMATCH$/.test(code)) return make("EVIDENCE_MISMATCH", "REDISPATCH_FRESH_EVIDENCE", false);
  if (code === "WORKERS_AI_MODEL_INVALID" || code === "CODING_RUNNER_REQUEST_INVALID" || /^CODING_RUNNER_[A-Z_]+_(INVALID|REQUIRED)$/.test(code)) {
    return make("REQUEST_INVALID", "STOP", false);
  }
  const transientHttp = Number.isSafeInteger(httpStatus) && httpStatus! >= 500 && httpStatus! <= 599;
  const githubModelsTransient = /^GITHUB_MODELS_CODING_HTTP_5\d\d$/.test(code);
  if (PROVIDER.has(code) || githubModelsTransient || (code === "coding-engine-request-failed" && transientHttp)) {
    return make("PROVIDER_FAILURE", "RETRY_BOUNDED", true);
  }
  if (RETRYABLE_PROPOSAL_FAILURES.has(code)) return make("PROPOSAL_REJECTED", "REGENERATE_PROPOSAL", true);
  return make("UNKNOWN", "STOP", false);
}
