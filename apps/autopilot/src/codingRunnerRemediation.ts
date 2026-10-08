import { classifyCodingRunnerFailure, type CodingRunnerFailureClass, type CodingRunnerRecovery } from "./codingRunnerFailureClass";

export type CodingRunnerNoActionOutcome = "VALID_NO_ACTION" | "FAILED_TO_REMEDIATE" | "FAILED_CLOSED";

export interface CodingRunnerRemediationDecision {
  readonly outcome: CodingRunnerNoActionOutcome;
  readonly failureClass: CodingRunnerFailureClass;
  readonly recovery: CodingRunnerRecovery;
  readonly retryable: boolean;
  readonly attempt: number;
  readonly maxAttempts: number;
}

/**
 * Classifies a coding-runner no-change result without turning safety/contract failures into a
 * successful abstention. This function never retries or grants authority. A caller may act only
 * when retryable=true and only within maxAttempts.
 */
export function decideCodingRunnerNoAction(
  reason: unknown,
  attempt: number,
  maxAttempts = 2,
): CodingRunnerRemediationDecision {
  if (!Number.isSafeInteger(attempt) || attempt < 0 || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new Error("CODING_REMEDIATION_ATTEMPT_LIMIT_INVALID");
  }
  if (reason === "NO_ACTION_WARRANTED") {
    return Object.freeze({
      outcome: "VALID_NO_ACTION",
      failureClass: "UNKNOWN",
      recovery: "STOP",
      retryable: false,
      attempt,
      maxAttempts,
    });
  }
  const classification = classifyCodingRunnerFailure(reason);
  const retryable = classification.retryable && attempt < maxAttempts;
  return Object.freeze({
    outcome: classification.retryable ? "FAILED_TO_REMEDIATE" : "FAILED_CLOSED",
    failureClass: classification.failureClass,
    recovery: classification.recovery,
    retryable,
    attempt,
    maxAttempts,
  });
}
