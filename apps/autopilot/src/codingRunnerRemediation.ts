import { classifyCodingRunnerFailure, type CodingRunnerFailureClass, type CodingRunnerRecovery } from "./codingRunnerFailureClass";

export type CodingRunnerNoActionOutcome = "VALID_NO_ACTION" | "FAILED_TO_REMEDIATE";

export interface CodingRunnerRemediationDecision {
  readonly outcome: CodingRunnerNoActionOutcome;
  readonly failureClass: CodingRunnerFailureClass;
  readonly recovery: CodingRunnerRecovery;
  readonly retryable: boolean;
  readonly attempt: number;
  readonly maxAttempts: number;
}

/**
 * Decides whether a no-change result is a legitimate abstention or a failed remediation.
 * It never performs a retry or grants authority. The caller may act only when retryable=true,
 * and only within maxAttempts. Unknown/authority/evidence-mismatch/config/capacity states fail closed.
 */
export function decideCodingRunnerNoAction(
  reason: unknown,
  attempt: number,
  maxAttempts = 2,
): CodingRunnerRemediationDecision {
  if (!Number.isSafeInteger(attempt) || attempt < 0 || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new Error("CODING_REMEDIATION_ATTEMPT_LIMIT_INVALID");
  }
  const classification = classifyCodingRunnerFailure(reason);
  const retryable = classification.retryable && attempt < maxAttempts;
  return Object.freeze({
    outcome: classification.retryable ? "FAILED_TO_REMEDIATE" : "VALID_NO_ACTION",
    failureClass: classification.failureClass,
    recovery: classification.recovery,
    retryable,
    attempt,
    maxAttempts,
  });
}
