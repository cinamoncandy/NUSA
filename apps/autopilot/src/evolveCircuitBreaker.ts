export type EvolutionCircuitState = "CLOSED" | "OPEN";

export interface EvolutionCircuitBreakerPolicy {
  readonly maxFailures: number;
  readonly cooldownSeconds: number;
}

export interface EvolutionCircuitBreakerState {
  readonly state: EvolutionCircuitState;
  readonly consecutiveFailures: number;
  readonly openedAt?: string;
}

const positiveInteger = (value: number): boolean => Number.isInteger(value) && value > 0;

export function validateCircuitBreakerPolicy(policy: EvolutionCircuitBreakerPolicy): EvolutionCircuitBreakerPolicy {
  if (!positiveInteger(policy.maxFailures)) throw new Error("EVOLVE_CIRCUIT_MAX_FAILURES_INVALID");
  if (!positiveInteger(policy.cooldownSeconds)) throw new Error("EVOLVE_CIRCUIT_COOLDOWN_INVALID");
  return Object.freeze({ ...policy });
}

export function recordCircuitFailure(
  state: EvolutionCircuitBreakerState,
  policy: EvolutionCircuitBreakerPolicy,
  now: string,
): EvolutionCircuitBreakerState {
  const boundedPolicy = validateCircuitBreakerPolicy(policy);
  const failures = state.consecutiveFailures + 1;
  if (failures >= boundedPolicy.maxFailures) {
    return Object.freeze({ state: "OPEN", consecutiveFailures: failures, openedAt: now });
  }
  return Object.freeze({ state: "CLOSED", consecutiveFailures: failures });
}

export function canAttemptCircuitRecovery(
  state: EvolutionCircuitBreakerState,
  policy: EvolutionCircuitBreakerPolicy,
  now: string,
): boolean {
  if (state.state === "CLOSED") return true;
  if (!state.openedAt) return false;
  const opened = Date.parse(state.openedAt);
  const current = Date.parse(now);
  if (!Number.isFinite(opened) || !Number.isFinite(current)) return false;
  return current - opened >= validateCircuitBreakerPolicy(policy).cooldownSeconds * 1000;
}

export function resetCircuitBreaker(): EvolutionCircuitBreakerState {
  return Object.freeze({ state: "CLOSED", consecutiveFailures: 0 });
}
