/**
 * Fail-closed classification for coding-runner failures. This module is pure: it grants no
 * authority and performs no retry. Only explicit, known reason codes can become retryable.
 */
export type CodingRunnerFailureClass =
  | "AUDIT_BLOCKED"
  | "RELEASE_BLOCKED"
  | "DEPLOYMENT_FAILURE"
  | "PERMISSION_FAILURE"
  | "WORKFLOW_NOT_ELIGIBLE"
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
const UNVERIFIED_GITHUB_LOOKUP = new Set(["CODING_RUNNER_HEAD_SHA_UNVERIFIED", "CODING_RUNNER_WORKFLOW_RUN_UNVERIFIED", "CODING_RUNNER_MAIN_SHA_UNVERIFIED"]);
const STALE_EVIDENCE = new Set(["CODING_PUBLISH_STALE_HEAD_SUPPRESSED", "CODING_RUNNER_WORKFLOW_NOT_SUCCESSFUL", "CODING_RUNNER_FAILURE_EVIDENCE_INVALID", "CODING_RUNNER_WORKFLOW_HEAD_STALE"]);
const PROVIDER = new Set(["WORKERS_AI_CODING_ENGINE_FAILED", "GITHUB_MODELS_CODING_FAILED"]);
// Keep this synchronized with RETRYABLE_PROPOSAL_FAILURE_CODES in scripts/autopilot-dispatch-retry.js.
// CODING_PROPOSAL_REPEATED is intentionally excluded so a deterministic repeat cannot spend another inference.
const RETRYABLE_PROPOSAL_FAILURES = new Set([
  "CODING_PROPOSAL_FAILED_CLOSED",
  "CODING_PROPOSAL_INVALID",
  "CODING_PROPOSAL_JSON_INVALID",
  "CODING_PROPOSAL_PATCH_REQUIRED",
  "CODING_PROPOSAL_RESPONSE_INVALID",
  "CODING_PROPOSAL_SHAPE_INVALID",
  "CODING_PROPOSAL_TOO_LARGE",
  "CODING_PROPOSAL_UNAVAILABLE",
  "CODING_EDIT_CONTEXT_REQUIRED",
  "CODING_EDIT_CONTEXT_PATH_MISMATCH",
  "CODING_EDIT_ANCHOR_NOT_FOUND",
  "SANDBOX_PATCH_APPLY_CHECK_FAILED",
  "SANDBOX_PATCH_NORMALIZED_APPLY_CHECK_FAILED",
  "SANDBOX_BUILD_FAILED",
  "SANDBOX_PATCH_FILE_COUNT_INVALID",
  "SANDBOX_PATCH_REQUIRED",
  "SANDBOX_PATCH_TOO_LARGE",
  "GITHUB_MODELS_CODING_RESPONSE_INVALID",
]);

function transientHttpStatus(httpStatus?: number): boolean {
  return Number.isSafeInteger(httpStatus) && httpStatus! >= 500 && httpStatus! <= 599;
}

function transientProviderFailureHttpStatus(httpStatus?: number): boolean {
  return Number.isSafeInteger(httpStatus) && httpStatus! >= 500 && httpStatus! <= 599;
}

function normalizeAllowlistedSandboxFailure(code: string): string {
  const separator = code.indexOf(":");
  if (separator < 0) return code;
  const prefix = code.slice(0, separator);
  return prefix.startsWith("SANDBOX_") && RETRYABLE_PROPOSAL_FAILURES.has(prefix) ? prefix : code;
}

export function classifyCodingRunnerFailure(reason: unknown, httpStatus?: number): CodingRunnerFailureClassification {
  const rawCode = typeof reason === "string" ? reason.trim() : "";
  const code = normalizeAllowlistedSandboxFailure(rawCode);
  const failClosedWorkflowCodes = new Map<CodingRunnerFailureClass, readonly string[]>([
    ["AUDIT_BLOCKED", ["AUDIT_BLOCKED"]],
    ["RELEASE_BLOCKED", ["RELEASE_BLOCKED"]],
    ["DEPLOYMENT_FAILURE", ["DEPLOYMENT_FAILURE"]],
    ["PERMISSION_FAILURE", ["PERMISSION_FAILURE"]],
    ["WORKFLOW_NOT_ELIGIBLE", ["WORKFLOW_NOT_ELIGIBLE", "ACTIONABLE_FAILURE_NOT_ALLOWLISTED"]],
    ["EVIDENCE_UNVERIFIED", ["WORKFLOW_IDENTITY_MISSING", "ACTIONABLE_FAILURE_EVIDENCE_UNVERIFIED"]],
    ["EVIDENCE_MISMATCH", ["WORKFLOW_IDENTITY_MISMATCH"]],
  ]);
  for (const [failureClass, codes] of failClosedWorkflowCodes) {
    if (codes.includes(code)) return make(failureClass, "STOP", false);
  }
  if (/AUTHORITY|PRODUCTION_MUTATION/.test(code)) return make("AUTHORITY_VIOLATION", "STOP", false);
  if (code === "PROVIDER_CAPACITY_STATE_UNAVAILABLE") return make("PROVIDER_CAPACITY", "STOP", false);
  if (CAPACITY.has(code)) return make("PROVIDER_CAPACITY", "WAIT_FOR_PROVIDER", false);
  // HTTP 429 is provider backpressure for every coding endpoint. It must never spend the
  // repository-remediation retry budget, including when the request was a GitHub evidence lookup.
  if (httpStatus === 429) return make("PROVIDER_CAPACITY", "WAIT_FOR_PROVIDER", false);
  if (code === "CODING_RUNNER_WORKFLOW_NOT_COMPLETED") return make("EVIDENCE_UNVERIFIED", "RETRY_BOUNDED", true);
  if (UNVERIFIED_GITHUB_LOOKUP.has(code)) {
    return transientHttpStatus(httpStatus)
      ? make("EVIDENCE_UNVERIFIED", "RETRY_BOUNDED", true)
      : make("EVIDENCE_UNVERIFIED", "STOP", false);
  }
  if (STALE_EVIDENCE.has(code) || /^CODING_RUNNER_[A-Z_]+_MISMATCH$/.test(code)) return make("EVIDENCE_MISMATCH", "REDISPATCH_FRESH_EVIDENCE", false);
  if (code === "WORKERS_AI_MODEL_INVALID" || code === "CODING_RUNNER_REQUEST_INVALID" || /^CODING_RUNNER_[A-Z_]+_(INVALID|REQUIRED)$/.test(code)) {
    return make("REQUEST_INVALID", "STOP", false);
  }
  if (code === "coding-engine-request-failed" && httpStatus === 429) return make("PROVIDER_CAPACITY", "WAIT_FOR_PROVIDER", false);
  const githubModelsTransient = /^GITHUB_MODELS_CODING_HTTP_5\d\d$/.test(code);
  if (PROVIDER.has(code) || githubModelsTransient || (code === "coding-engine-request-failed" && transientProviderFailureHttpStatus(httpStatus))) {
    return make("PROVIDER_FAILURE", "RETRY_BOUNDED", true);
  }
  if (RETRYABLE_PROPOSAL_FAILURES.has(code)) return make("PROPOSAL_REJECTED", "REGENERATE_PROPOSAL", true);
  return make("UNKNOWN", "STOP", false);
}
