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

export function classifyCodingRunnerFailure(reason: unknown): CodingRunnerFailureClassification {
  const code = typeof reason === "string" ? reason.trim() : "";
  if (/^CODING_RUNNER_(LIVE_AUTHORITY|PRODUCTION_MUTATION|AI_AUTHORITY)/.test(code) || /AUTHORITY_SURFACE_FORBIDDEN$/.test(code)) {
    return make("AUTHORITY_VIOLATION", "STOP", false);
  }
  if (code === "WORKERS_AI_DAILY_QUOTA_EXHAUSTED" || code === "WORKERS_AI_RATE_LIMITED" || code === "WAITING_PROVIDER_CAPACITY" || code === "BLOCKED_RATE_LIMIT") {
    return make("PROVIDER_CAPACITY", "WAIT_FOR_PROVIDER", false);
  }
  if (/_UNVERIFIED$/.test(code) || code === "CODING_RUNNER_WORKFLOW_NOT_COMPLETED" || code === "PROVIDER_CAPACITY_STATE_UNAVAILABLE") {
    return make("EVIDENCE_UNVERIFIED", "RETRY_BOUNDED", true);
  }
  if (/_MISMATCH$/.test(code) || code === "CODING_RUNNER_WORKFLOW_NOT_SUCCESSFUL" || code === "CODING_RUNNER_FAILURE_EVIDENCE_INVALID") {
    return make("EVIDENCE_MISMATCH", "REDISPATCH_FRESH_EVIDENCE", false);
  }
  if (/^CODING_RUNNER_[A-Z_]+_(INVALID|REQUIRED)$/.test(code) || code === "CODING_RUNNER_REQUEST_INVALID") {
    return make("REQUEST_INVALID", "STOP", false);
  }
  if (code === "WORKERS_AI_CODING_ENGINE_FAILED" || code === "GITHUB_MODELS_CODING_FAILED" || code === "WORKERS_AI_MODEL_INVALID") {
    return make("PROVIDER_FAILURE", "RETRY_BOUNDED", true);
  }
  if (/^(CODING_EDIT_|CODING_PROPOSAL_|SANDBOX_PATCH_|GITHUB_MODELS_CODING_RESPONSE_INVALID)/.test(code)) {
    return make("PROPOSAL_REJECTED", "REGENERATE_PROPOSAL", true);
  }
  return make("UNKNOWN", "STOP", false);
}
