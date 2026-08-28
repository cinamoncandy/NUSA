export type AutonomousExecutionStatus =
  | "READY"
  | "LEASED"
  | "CODEX_DISPATCHED"
  | "PR_OPEN"
  | "CI_RUNNING"
  | "CI_FAILED"
  | "CI_PASSED"
  | "MERGE_READY"
  | "MERGED"
  | "OUTCOME_EVALUATING"
  | "VERIFIED_IMPROVEMENT"
  | "NEUTRAL"
  | "REGRESSION"
  | "INSUFFICIENT"
  | "BLOCKED"
  | "HUMAN_ONLY";

export interface ExecutionIdentity {
  readonly cycleId: string;
  readonly workItemId: string;
  readonly executionId: string;
  readonly dedupeKey: string;
}

export interface ExecutionLease {
  readonly executionId: string;
  readonly holder: string;
  readonly acquiredAt: number;
  readonly expiresAt: number;
  readonly heartbeatAt: number;
}

export interface AutonomousExecutionState extends ExecutionIdentity {
  readonly status: AutonomousExecutionStatus;
  readonly lease: ExecutionLease | null;
  readonly mutationAllowed: false;
}

const transitions: Readonly<Record<AutonomousExecutionStatus, readonly AutonomousExecutionStatus[]>> = Object.freeze({
  READY: ["LEASED", "BLOCKED", "HUMAN_ONLY"],
  LEASED: ["CODEX_DISPATCHED", "READY", "BLOCKED", "HUMAN_ONLY"],
  CODEX_DISPATCHED: ["PR_OPEN", "BLOCKED", "HUMAN_ONLY"],
  PR_OPEN: ["CI_RUNNING", "BLOCKED", "HUMAN_ONLY"],
  CI_RUNNING: ["CI_FAILED", "CI_PASSED", "BLOCKED", "HUMAN_ONLY"],
  CI_FAILED: ["CODEX_DISPATCHED", "BLOCKED", "HUMAN_ONLY"],
  CI_PASSED: ["MERGE_READY", "BLOCKED", "HUMAN_ONLY"],
  MERGE_READY: ["MERGED", "CI_RUNNING", "BLOCKED", "HUMAN_ONLY"],
  MERGED: ["OUTCOME_EVALUATING", "BLOCKED"],
  OUTCOME_EVALUATING: ["VERIFIED_IMPROVEMENT", "NEUTRAL", "REGRESSION", "INSUFFICIENT", "BLOCKED"],
  VERIFIED_IMPROVEMENT: [],
  NEUTRAL: [],
  REGRESSION: [],
  INSUFFICIENT: [],
  BLOCKED: [],
  HUMAN_ONLY: [],
});

const nonEmpty = (value: string): boolean => value.trim().length > 0;

export function createExecutionState(identity: ExecutionIdentity): AutonomousExecutionState {
  if (![identity.cycleId, identity.workItemId, identity.executionId, identity.dedupeKey].every(nonEmpty)) {
    throw new Error("AUTONOMOUS_EXECUTION_IDENTITY_INVALID");
  }
  return Object.freeze({ ...identity, status: "READY", lease: null, mutationAllowed: false });
}

export function transitionExecution(
  state: AutonomousExecutionState,
  next: AutonomousExecutionStatus,
): AutonomousExecutionState {
  if (!transitions[state.status].includes(next)) throw new Error("AUTONOMOUS_EXECUTION_TRANSITION_INVALID");
  if (state.status === "LEASED" && next === "CODEX_DISPATCHED" && state.lease === null) {
    throw new Error("AUTONOMOUS_EXECUTION_LEASE_REQUIRED");
  }
  return Object.freeze({ ...state, status: next, lease: next === "READY" ? null : state.lease, mutationAllowed: false });
}

export function acquireExecutionLease(
  state: AutonomousExecutionState,
  holder: string,
  now: number,
  ttlMs: number,
): AutonomousExecutionState {
  if (state.status !== "READY" || state.lease !== null) throw new Error("AUTONOMOUS_EXECUTION_NOT_LEASABLE");
  if (!nonEmpty(holder) || !Number.isFinite(now) || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error("AUTONOMOUS_EXECUTION_LEASE_INVALID");
  }
  const lease = Object.freeze({ executionId: state.executionId, holder, acquiredAt: now, expiresAt: now + ttlMs, heartbeatAt: now });
  return Object.freeze({ ...state, status: "LEASED", lease, mutationAllowed: false });
}

export function recoverExpiredLease(state: AutonomousExecutionState, now: number): AutonomousExecutionState {
  if (!Number.isFinite(now)) throw new Error("AUTONOMOUS_EXECUTION_RECOVERY_TIME_INVALID");
  if (state.status !== "LEASED" || state.lease === null || state.lease.expiresAt > now) return state;
  return Object.freeze({ ...state, status: "READY", lease: null, mutationAllowed: false });
}

export function isDuplicateExecution(
  active: readonly AutonomousExecutionState[],
  candidate: ExecutionIdentity,
): boolean {
  return active.some((state) =>
    state.executionId === candidate.executionId ||
    state.dedupeKey === candidate.dedupeKey ||
    (state.cycleId === candidate.cycleId && state.workItemId === candidate.workItemId),
  );
}
