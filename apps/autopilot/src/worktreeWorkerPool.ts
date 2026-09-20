/**
 * Deterministic admission boundary for the #903 queue's isolated Codex workers.
 *
 * This module deliberately does not create branches, worktrees, or PRs. Those
 * side effects remain owned by the canonical worker/release path. It only
 * admits a safe, bounded claim and records enough identity/timing data for the
 * worker to create its own isolated workspace and for throughput to be proven.
 */

export type WorkerClaimState = "CLAIMED" | "RUNNING";

export interface WorkerTask {
  readonly taskId: string;
  readonly issueNumber: number | null;
  readonly dedupeKey: string;
  readonly executionId: string;
  readonly branchName: string;
  readonly worktreePath: string;
  readonly canonicalOwner: string;
  readonly conflictKeys: readonly string[];
  readonly dependencies: readonly string[];
  readonly priority: number;
  readonly queuedAt: number;
}

export interface WorkerClaim {
  readonly task: WorkerTask;
  readonly workerId: string;
  readonly state: WorkerClaimState;
  readonly claimedAt: number;
  readonly leaseExpiresAt: number;
  readonly startedAt: number | null;
}

export interface WorkerPoolState {
  readonly schemaVersion: 1;
  readonly maxWip: number;
  readonly claims: readonly WorkerClaim[];
}

export interface WorkerPoolMetrics {
  readonly taskId: string;
  readonly workerId: string;
  readonly queuedAt: number;
  readonly claimedAt: number;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly queueWaitMs: number;
  readonly claimToStartMs: number;
  readonly claimToCompleteMs: number;
  readonly totalMs: number;
}

export type WorkerAdmissionRejection =
  | "DEPENDENCY_NOT_READY"
  | "DUPLICATE_TASK"
  | "DEDUPE_CONFLICT"
  | "EXECUTION_ID_CONFLICT"
  | "BRANCH_CONFLICT"
  | "WORKTREE_CONFLICT"
  | "CONFLICT_KEY_ACTIVE"
  | "WIP_LIMIT_REACHED";

export interface WorkerAdmissionAccepted {
  readonly admitted: true;
  readonly state: WorkerPoolState;
  readonly claim: WorkerClaim;
  readonly recoveredTaskIds: readonly string[];
}

export interface WorkerAdmissionRejected {
  readonly admitted: false;
  readonly reason: WorkerAdmissionRejection;
  readonly state: WorkerPoolState;
  readonly recoveredTaskIds: readonly string[];
}

export type WorkerAdmissionResult = WorkerAdmissionAccepted | WorkerAdmissionRejected;

export interface WorkerIdentity {
  readonly taskId: string;
  readonly executionId: string;
  readonly workerId: string;
}

const SAFE_ID = /^[A-Za-z0-9_.:/-]{1,256}$/;
const SAFE_BRANCH = /^[A-Za-z0-9_.][A-Za-z0-9_./-]{0,199}$/;
const SAFE_WORKTREE = /^[A-Za-z0-9_./:-]{1,512}$/;
const MAX_CLAIMS = 8;
const MAX_DEPENDENCIES = 32;
const MAX_CONFLICT_KEYS = 32;
const MAX_LEASE_MS = 60 * 60 * 1000;

const freezeState = (maxWip: number, claims: readonly WorkerClaim[]): WorkerPoolState => Object.freeze({
  schemaVersion: 1 as const,
  maxWip,
  claims: Object.freeze([...claims].sort((left, right) => left.claimedAt - right.claimedAt || left.task.taskId.localeCompare(right.task.taskId))),
});

const validTimestamp = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const validPositiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const validId = (value: unknown): value is string => typeof value === "string" && SAFE_ID.test(value);

function validTask(value: unknown): value is WorkerTask {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const task = value as Partial<WorkerTask>;
  const issueOk = task.issueNumber === null || validPositiveInteger(task.issueNumber);
  const conflictKeys = task.conflictKeys;
  const dependencies = task.dependencies;
  return validId(task.taskId)
    && issueOk
    && validId(task.dedupeKey)
    && validId(task.executionId)
    && typeof task.branchName === "string" && SAFE_BRANCH.test(task.branchName)
    && typeof task.worktreePath === "string" && SAFE_WORKTREE.test(task.worktreePath)
    && validId(task.canonicalOwner)
    && Array.isArray(conflictKeys) && conflictKeys.length > 0 && conflictKeys.length <= MAX_CONFLICT_KEYS
    && conflictKeys.every(validId) && new Set(conflictKeys).size === conflictKeys.length
    && Array.isArray(dependencies) && dependencies.length <= MAX_DEPENDENCIES
    && dependencies.every(validId) && new Set(dependencies).size === dependencies.length
    && Number.isFinite(task.priority) && Number(task.priority) >= 0 && Number(task.priority) <= 1
    && validTimestamp(task.queuedAt);
}

function validClaim(value: unknown): value is WorkerClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const claim = value as Partial<WorkerClaim>;
  return validTask(claim.task)
    && validId(claim.workerId)
    && (claim.state === "CLAIMED" || claim.state === "RUNNING")
    && validTimestamp(claim.claimedAt)
    && validTimestamp(claim.leaseExpiresAt)
    && claim.leaseExpiresAt > claim.claimedAt
    && (claim.startedAt === null || validTimestamp(claim.startedAt))
    && (claim.startedAt === null || claim.startedAt >= claim.claimedAt);
}

export function validateWorkerPoolState(value: unknown): asserts value is WorkerPoolState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("WORKER_POOL_STATE_CORRUPT");
  const state = value as Partial<WorkerPoolState>;
  if (state.schemaVersion !== 1 || !validPositiveInteger(state.maxWip) || state.maxWip > MAX_CLAIMS || !Array.isArray(state.claims) || state.claims.length > state.maxWip) throw new Error("WORKER_POOL_STATE_CORRUPT");
  const taskIds = new Set<string>();
  const executionIds = new Set<string>();
  const dedupeKeys = new Set<string>();
  const branches = new Set<string>();
  const worktrees = new Set<string>();
  const conflicts = new Set<string>();
  for (const claim of state.claims) {
    if (!validClaim(claim)) throw new Error("WORKER_POOL_STATE_CORRUPT");
    if (taskIds.has(claim.task.taskId) || executionIds.has(claim.task.executionId) || dedupeKeys.has(claim.task.dedupeKey) || branches.has(claim.task.branchName) || worktrees.has(claim.task.worktreePath)) throw new Error("WORKER_POOL_STATE_CORRUPT");
    for (const key of claim.task.conflictKeys) if (conflicts.has(key)) throw new Error("WORKER_POOL_STATE_CORRUPT");
    taskIds.add(claim.task.taskId);
    executionIds.add(claim.task.executionId);
    dedupeKeys.add(claim.task.dedupeKey);
    branches.add(claim.task.branchName);
    worktrees.add(claim.task.worktreePath);
    claim.task.conflictKeys.forEach((key) => conflicts.add(key));
  }
}

export function createWorkerPoolState(maxWip: number): WorkerPoolState {
  if (!validPositiveInteger(maxWip) || maxWip > MAX_CLAIMS) throw new Error("WORKER_POOL_MAX_WIP_INVALID");
  return freezeState(maxWip, []);
}

export function recoverExpiredWorkerClaims(state: WorkerPoolState, now: number): { readonly state: WorkerPoolState; readonly recoveredTaskIds: readonly string[] } {
  validateWorkerPoolState(state);
  if (!validTimestamp(now)) throw new Error("WORKER_POOL_NOW_INVALID");
  const active = state.claims.filter((claim) => claim.leaseExpiresAt > now);
  const recoveredTaskIds = Object.freeze(state.claims.filter((claim) => claim.leaseExpiresAt <= now).map((claim) => claim.task.taskId));
  return Object.freeze({ state: freezeState(state.maxWip, active), recoveredTaskIds });
}

export function admitWorkerTask(
  state: WorkerPoolState,
  task: WorkerTask,
  workerId: string,
  now: number,
  leaseMs: number,
  completedTaskIds: readonly string[] = [],
): WorkerAdmissionResult {
  validateWorkerPoolState(state);
  if (!validTask(task)) throw new Error("WORKER_TASK_INVALID");
  if (!validId(workerId) || !validTimestamp(now) || !validPositiveInteger(leaseMs) || leaseMs > MAX_LEASE_MS || now < task.queuedAt) throw new Error("WORKER_ADMISSION_INPUT_INVALID");
  const recovered = recoverExpiredWorkerClaims(state, now);
  const active = recovered.state;
  if (task.dependencies.some((dependency) => !completedTaskIds.includes(dependency))) return Object.freeze({ admitted: false, reason: "DEPENDENCY_NOT_READY", state: active, recoveredTaskIds: recovered.recoveredTaskIds });
  if (active.claims.some((claim) => claim.task.taskId === task.taskId)) return Object.freeze({ admitted: false, reason: "DUPLICATE_TASK", state: active, recoveredTaskIds: recovered.recoveredTaskIds });
  if (active.claims.some((claim) => claim.task.dedupeKey === task.dedupeKey)) return Object.freeze({ admitted: false, reason: "DEDUPE_CONFLICT", state: active, recoveredTaskIds: recovered.recoveredTaskIds });
  if (active.claims.some((claim) => claim.task.executionId === task.executionId)) return Object.freeze({ admitted: false, reason: "EXECUTION_ID_CONFLICT", state: active, recoveredTaskIds: recovered.recoveredTaskIds });
  if (active.claims.some((claim) => claim.task.branchName === task.branchName)) return Object.freeze({ admitted: false, reason: "BRANCH_CONFLICT", state: active, recoveredTaskIds: recovered.recoveredTaskIds });
  if (active.claims.some((claim) => claim.task.worktreePath === task.worktreePath)) return Object.freeze({ admitted: false, reason: "WORKTREE_CONFLICT", state: active, recoveredTaskIds: recovered.recoveredTaskIds });
  if (active.claims.some((claim) => claim.task.conflictKeys.some((key) => task.conflictKeys.includes(key)))) return Object.freeze({ admitted: false, reason: "CONFLICT_KEY_ACTIVE", state: active, recoveredTaskIds: recovered.recoveredTaskIds });
  if (active.claims.length >= active.maxWip) return Object.freeze({ admitted: false, reason: "WIP_LIMIT_REACHED", state: active, recoveredTaskIds: recovered.recoveredTaskIds });
  const claim: WorkerClaim = Object.freeze({ task: Object.freeze({ ...task, conflictKeys: Object.freeze([...task.conflictKeys]), dependencies: Object.freeze([...task.dependencies]) }), workerId, state: "CLAIMED", claimedAt: now, leaseExpiresAt: now + leaseMs, startedAt: null });
  return Object.freeze({ admitted: true, claim, state: freezeState(active.maxWip, [...active.claims, claim]), recoveredTaskIds: recovered.recoveredTaskIds });
}

export function startWorkerClaim(state: WorkerPoolState, identity: WorkerIdentity, now: number): WorkerPoolState {
  validateWorkerPoolState(state);
  if (!validId(identity.taskId) || !validId(identity.executionId) || !validId(identity.workerId) || !validTimestamp(now)) throw new Error("WORKER_START_INPUT_INVALID");
  const claim = state.claims.find((candidate) => candidate.task.taskId === identity.taskId);
  if (!claim || claim.workerId !== identity.workerId || claim.task.executionId !== identity.executionId) throw new Error("WORKER_IDENTITY_MISMATCH");
  if (claim.leaseExpiresAt <= now) throw new Error("WORKER_LEASE_EXPIRED");
  if (claim.state === "RUNNING") return state;
  return freezeState(state.maxWip, state.claims.map((candidate) => candidate === claim ? Object.freeze({ ...candidate, state: "RUNNING" as const, startedAt: now }) : candidate));
}

export function renewWorkerLease(state: WorkerPoolState, identity: WorkerIdentity, now: number, leaseMs: number): WorkerPoolState {
  validateWorkerPoolState(state);
  if (!validTimestamp(now) || !validPositiveInteger(leaseMs) || leaseMs > MAX_LEASE_MS) throw new Error("WORKER_RENEW_INPUT_INVALID");
  const claim = state.claims.find((candidate) => candidate.task.taskId === identity.taskId);
  if (!claim || claim.workerId !== identity.workerId || claim.task.executionId !== identity.executionId) throw new Error("WORKER_IDENTITY_MISMATCH");
  if (claim.leaseExpiresAt <= now) throw new Error("WORKER_LEASE_EXPIRED");
  return freezeState(state.maxWip, state.claims.map((candidate) => candidate === claim ? Object.freeze({ ...candidate, leaseExpiresAt: now + leaseMs }) : candidate));
}

export function completeWorkerClaim(state: WorkerPoolState, identity: WorkerIdentity, now: number): { readonly state: WorkerPoolState; readonly metrics: WorkerPoolMetrics } {
  validateWorkerPoolState(state);
  if (!validTimestamp(now)) throw new Error("WORKER_COMPLETE_INPUT_INVALID");
  const claim = state.claims.find((candidate) => candidate.task.taskId === identity.taskId);
  if (!claim || claim.workerId !== identity.workerId || claim.task.executionId !== identity.executionId) throw new Error("WORKER_IDENTITY_MISMATCH");
  if (claim.state !== "RUNNING" || claim.startedAt === null) throw new Error("WORKER_NOT_RUNNING");
  // An expired lease means the allocator already treats this task as recoverable, so accepting the
  // completion would free a slot this worker no longer holds and would emit throughput metrics for
  // work another worker may be re-running. A worker that is still alive renews its lease instead.
  if (claim.leaseExpiresAt <= now) throw new Error("WORKER_LEASE_EXPIRED");
  if (now < claim.startedAt || now < claim.task.queuedAt) throw new Error("WORKER_COMPLETION_TIME_INVALID");
  const metrics: WorkerPoolMetrics = Object.freeze({ taskId: claim.task.taskId, workerId: claim.workerId, queuedAt: claim.task.queuedAt, claimedAt: claim.claimedAt, startedAt: claim.startedAt, completedAt: now, queueWaitMs: claim.claimedAt - claim.task.queuedAt, claimToStartMs: claim.startedAt - claim.claimedAt, claimToCompleteMs: now - claim.claimedAt, totalMs: now - claim.task.queuedAt });
  return Object.freeze({ state: freezeState(state.maxWip, state.claims.filter((candidate) => candidate !== claim)), metrics });
}
