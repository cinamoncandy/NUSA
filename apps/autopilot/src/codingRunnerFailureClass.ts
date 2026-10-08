/**
 * Failure classification for the external coding runner. Pure and advisory: it maps a runner reason
 * code to a class and a bounded recovery hint. It never grants authority, retries anything itself, or
 * widens what the runner may do. Unknown codes fail closed (UNKNOWN, not retryable).
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

export type CodingRunnerRecovery = "STOP" | "WAIT_FOR_PROVIDER" | "RETRY_BOUNDED" | "REGENERATE_PROPOSAL" | "REDISPATCH_FRESH_EVIDENCE";

export interface CodingRunnerFailureClassification {
  readonly failureClass: CodingRunnerFailureClass;
  readonly recovery: CodingRunnerRecovery;
  /** True only when a bounded retry may help without new evidence. */
  readonly retryable: boolean;
}

const make = (failureClass: CodingRunnerFailureClass, recovery: CodingRunnerRecovery, retryable: boolean): CodingRunnerFailureClassification =>
  Object.freeze({ failureClass, recovery, retryable });

const CAPACITY = new Set(["WORKERS_AI_DAILY_QUOTA_EXHAUSTED", "WORKERS_AI_RATE_LIMITED", "WAITING_PROVIDER_CAPACITY", "BLOCKED_RATE_LIMIT"]);
const UNVERIFIED = new Set(["CODING_RUNNER_HEAD_SHA_UNVERIFIED", "CODING_RUNNER_WORKFLOW_RUN_UNVERIFIED", "CODING_RUNNER_WORKFLOW_NOT_COMPLETED", "PROVIDER_CAPACITY_STATE_UNAVAILABLE"]);
const STALE_EVIDENCE = new Set(["CODING_PUBLISH_STALE_HEAD_SUPPRESSED", "CODING_RUNNER_WORKFLOW_NOT_SUCCESSFUL", "CODING_RUNNER_FAILURE_EVIDENCE_INVALID"]);
const PROVIDER = new Set(["WORKERS_AI_CODING_ENGINE_FAILED", "GITHUB_MODELS_CODING_FAILED"]);

export function classifyCodingRunnerFailure(reason: unknown): CodingRunnerFailureClassification {
  const code = typeof reason === "string" ? reason.trim() : "";
  // Authority first, by namespace-free substring: any code that names an authority or production-mutation
  // surface stops, whatever prefix a runtime adapter gives it.
  if (/AUTHORITY|PRODUCTION_MUTATION/.test(code)) return make("AUTHORITY_VIOLATION", "STOP", false);
  if (CAPACITY.has(code)) return make("PROVIDER_CAPACITY", "WAIT_FOR_PROVIDER", false);
  // A malformed edit is regenerated even when its code ends in _MISMATCH (CODING_EDIT_CONTEXT_PATH_MISMATCH).
  if (code.startsWith("CODING_EDIT_")) return make("PROPOSAL_REJECTED", "REGENERATE_PROPOSAL", true);
  if (UNVERIFIED.has(code)) return make("EVIDENCE_UNVERIFIED", "RETRY_BOUNDED", true);
  if (STALE_EVIDENCE.has(code) || /^CODING_RUNNER_[A-Z_]+_MISMATCH$/.test(code)) return make("EVIDENCE_MISMATCH", "REDISPATCH_FRESH_EVIDENCE", false);
  // Deterministic configuration/request faults: a retry repeats the same failure.
  if (code === "WORKERS_AI_MODEL_INVALID" || code === "CODING_RUNNER_REQUEST_INVALID" || /^CODING_RUNNER_[A-Z_]+_(INVALID|REQUIRED)$/.test(code)) {
    return make("REQUEST_INVALID", "STOP", false);
  }
  if (PROVIDER.has(code)) return make("PROVIDER_FAILURE", "RETRY_BOUNDED", true);
  if (/^(CODING_PROPOSAL_|SANDBOX_PATCH_)/.test(code) || code === "GITHUB_MODELS_CODING_RESPONSE_INVALID") {
    return make("PROPOSAL_REJECTED", "REGENERATE_PROPOSAL", true);
  }
  return make("UNKNOWN", "STOP", false);
}
