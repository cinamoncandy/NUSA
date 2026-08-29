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

const positiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const nonNegativeInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

export function validateCircuitBreakerState(state: EvolutionCircuitBreakerState): EvolutionCircuitBreakerState {
  if (state == null || typeof state !== "object") throw new Error("EVOLVE_CIRCUIT_STATE_INVALID");
  if (state.state !== "CLOSED" && state.state !== "OPEN") throw new Error("EVOLVE_CIRCUIT_STATE_INVALID");
  if (!nonNegativeInteger(state.consecutiveFailures)) throw new Error("EVOLVE_CIRCUIT_FAILURE_COUNT_INVALID");
  if (state.state === "OPEN" && state.consecutiveFailures === 0) throw new Error("EVOLVE_CIRCUIT_FAILURE_COUNT_INVALID");
  if (state.state === "OPEN" && !validTimestamp(state.openedAt)) throw new Error("EVOLVE_CIRCUIT_OPENED_AT_INVALID");
  if (state.openedAt !== undefined && !validTimestamp(state.openedAt)) throw new Error("EVOLVE_CIRCUIT_OPENED_AT_INVALID");
  return Object.freeze({
    state: state.state,
    consecutiveFailures: state.consecutiveFailures,
    ...(state.openedAt !== undefined ? { openedAt: state.openedAt } : {}),
  });
}

export function validateCircuitBreakerTimestamp(now: string): string {
  if (!validTimestamp(now)) throw new Error("EVOLVE_CIRCUIT_TIMESTAMP_INVALID");
  return now;
}

export function validateCircuitBreakerPolicy(policy: EvolutionCircuitBreakerPolicy): EvolutionCircuitBreakerPolicy {
  if (policy == null || typeof policy !== "object") throw new Error("EVOLVE_CIRCUIT_POLICY_INVALID");
  if (!positiveInteger(policy.maxFailures)) throw new Error("EVOLVE_CIRCUIT_MAX_FAILURES_INVALID");
  if (!positiveInteger(policy.cooldownSeconds)) throw new Error("EVOLVE_CIRCUIT_COOLDOWN_INVALID");
  return Object.freeze({ maxFailures: policy.maxFailures, cooldownSeconds: policy.cooldownSeconds });
}

export function recordCircuitFailure(
  state: EvolutionCircuitBreakerState,
  policy: EvolutionCircuitBreakerPolicy,
  now: string,
): EvolutionCircuitBreakerState {
  const boundedState = validateCircuitBreakerState(state);
  const boundedPolicy = validateCircuitBreakerPolicy(policy);
  const timestamp = validateCircuitBreakerTimestamp(now);
  const failures = boundedState.consecutiveFailures + 1;
  if (!nonNegativeInteger(failures)) throw new Error("EVOLVE_CIRCUIT_FAILURE_COUNT_INVALID");
  if (boundedState.state === "OPEN") {
    return Object.freeze({ state: "OPEN", consecutiveFailures: failures, openedAt: boundedState.openedAt });
  }
  if (failures >= boundedPolicy.maxFailures) {
    return Object.freeze({ state: "OPEN", consecutiveFailures: failures, openedAt: timestamp });
  }
  return Object.freeze({ state: "CLOSED", consecutiveFailures: failures });
}

export function canAttemptCircuitRecovery(
  state: EvolutionCircuitBreakerState,
  policy: EvolutionCircuitBreakerPolicy,
  now: string,
): boolean {
  const boundedState = validateCircuitBreakerState(state);
  const boundedPolicy = validateCircuitBreakerPolicy(policy);
  const current = Date.parse(validateCircuitBreakerTimestamp(now));
  if (boundedState.state === "CLOSED") return true;
  const opened = Date.parse(boundedState.openedAt!);
  return current - opened >= boundedPolicy.cooldownSeconds * 1000;
}

export function resetCircuitBreaker(): EvolutionCircuitBreakerState {
  return Object.freeze({ state: "CLOSED", consecutiveFailures: 0 });
}
