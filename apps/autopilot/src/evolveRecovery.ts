export type EvolutionRecoveryAction = "RETRY" | "ROLLBACK" | "ABSTAIN";

export interface EvolutionRecoveryDecision {
  readonly action: EvolutionRecoveryAction;
  readonly attempts: number;
  readonly reason: string;
}

export function decideEvolutionRecovery(input: {
  failureClass: "KNOWN_TRANSIENT" | "KNOWN_REGRESSION" | "UNKNOWN";
  attempts: number;
  rollbackEvidence: boolean;
}): EvolutionRecoveryDecision {
  if (!Number.isInteger(input.attempts) || input.attempts < 0) {
    throw new Error("EVOLVE_RECOVERY_ATTEMPTS_INVALID");
  }
  if (input.failureClass === "KNOWN_TRANSIENT" && input.attempts < 2) {
    return Object.freeze({ action: "RETRY", attempts: input.attempts + 1, reason: "bounded-transient-retry" });
  }
  if (input.failureClass === "KNOWN_REGRESSION" && input.rollbackEvidence) {
    return Object.freeze({ action: "ROLLBACK", attempts: input.attempts, reason: "evidenced-regression-rollback" });
  }
  return Object.freeze({ action: "ABSTAIN", attempts: input.attempts, reason: "insufficient-safe-recovery-evidence" });
}
