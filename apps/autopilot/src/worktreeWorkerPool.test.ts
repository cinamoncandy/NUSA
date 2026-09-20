import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { admitWorkerTask, completeWorkerClaim, createWorkerPoolState, recoverExpiredWorkerClaims, renewWorkerLease, startWorkerClaim, validateWorkerPoolState } from "./worktreeWorkerPool";

const task = (id: string, overrides: Partial<Parameters<typeof admitWorkerTask>[1]> = {}) => ({
  taskId: id,
  issueNumber: 2117,
  dedupeKey: `dedupe:${id}`,
  executionId: `execution:${id}`,
  branchName: `codex/${id}`,
  worktreePath: `.autopilot/worktrees/${id}`,
  canonicalOwner: "development",
  conflictKeys: [`issue:${id}`],
  dependencies: [],
  priority: 0.9,
  queuedAt: 100,
  ...overrides,
});
const rejection = (result: ReturnType<typeof admitWorkerTask>) => {
  assert.equal(result.admitted, false);
  if (result.admitted) throw new Error("expected admission rejection");
  return result.reason;
};

describe("worktree worker pool", () => {
  it("admits non-conflicting tasks in isolated identities up to bounded WIP", () => {
    let state = createWorkerPoolState(2);
    const first = admitWorkerTask(state, task("one"), "worker-1", 200, 1_000);
    assert.equal(first.admitted, true);
    if (!first.admitted) return;
    state = first.state;
    const second = admitWorkerTask(state, task("two"), "worker-2", 210, 1_000);
    assert.equal(second.admitted, true);
    if (!second.admitted) return;
    assert.equal(second.state.claims.length, 2);
    assert.notEqual(second.state.claims[0]?.task.worktreePath, second.state.claims[1]?.task.worktreePath);
    assert.notEqual(second.state.claims[0]?.task.branchName, second.state.claims[1]?.task.branchName);
  });

  it("rejects duplicate, execution, branch, worktree, conflict, and capacity collisions", () => {
    const admitted = admitWorkerTask(createWorkerPoolState(2), task("one"), "worker-1", 200, 1_000);
    assert.equal(admitted.admitted, true);
    if (!admitted.admitted) return;
    assert.equal(rejection(admitWorkerTask(admitted.state, task("one"), "worker-2", 201, 1_000)), "DUPLICATE_TASK");
    assert.equal(rejection(admitWorkerTask(admitted.state, task("two", { executionId: "execution:one" }), "worker-2", 201, 1_000)), "EXECUTION_ID_CONFLICT");
    assert.equal(rejection(admitWorkerTask(admitted.state, task("two", { branchName: "codex/one" }), "worker-2", 201, 1_000)), "BRANCH_CONFLICT");
    assert.equal(rejection(admitWorkerTask(admitted.state, task("two", { worktreePath: ".autopilot/worktrees/one" }), "worker-2", 201, 1_000)), "WORKTREE_CONFLICT");
    assert.equal(rejection(admitWorkerTask(admitted.state, task("two", { conflictKeys: ["issue:one"] }), "worker-2", 201, 1_000)), "CONFLICT_KEY_ACTIVE");
    const full = admitWorkerTask(admitted.state, task("two"), "worker-2", 201, 1_000);
    assert.equal(full.admitted, true);
    if (full.admitted) assert.equal(rejection(admitWorkerTask(full.state, task("three"), "worker-3", 202, 1_000)), "WIP_LIMIT_REACHED");
  });

  it("holds tasks until dependencies are completed", () => {
    const result = admitWorkerTask(createWorkerPoolState(2), task("child", { dependencies: ["parent"] }), "worker", 200, 1_000);
    assert.equal(rejection(result), "DEPENDENCY_NOT_READY");
    const admitted = admitWorkerTask(createWorkerPoolState(2), task("child", { dependencies: ["parent"] }), "worker", 200, 1_000, ["parent"]);
    assert.equal(admitted.admitted, true);
  });

  it("recovers only expired leases and allows deterministic re-admission", () => {
    const admitted = admitWorkerTask(createWorkerPoolState(1), task("one"), "worker-1", 200, 10);
    assert.equal(admitted.admitted, true);
    if (!admitted.admitted) return;
    const recovered = recoverExpiredWorkerClaims(admitted.state, 210);
    assert.deepEqual(recovered.recoveredTaskIds, ["one"]);
    const replay = admitWorkerTask(recovered.state, task("one"), "worker-2", 211, 1_000);
    assert.equal(replay.admitted, true);
  });

  it("requires exact identity for start and completion and emits measured timings", () => {
    const admitted = admitWorkerTask(createWorkerPoolState(1), task("one"), "worker-1", 200, 1_000);
    assert.equal(admitted.admitted, true);
    if (!admitted.admitted) return;
    assert.throws(() => startWorkerClaim(admitted.state, { taskId: "one", executionId: "wrong", workerId: "worker-1" }, 220), /WORKER_IDENTITY_MISMATCH/);
    const running = startWorkerClaim(admitted.state, { taskId: "one", executionId: "execution:one", workerId: "worker-1" }, 250);
    assert.throws(() => completeWorkerClaim(running, { taskId: "one", executionId: "execution:one", workerId: "worker-1" }, 249), /WORKER_COMPLETION_TIME_INVALID/);
    const completed = completeWorkerClaim(running, { taskId: "one", executionId: "execution:one", workerId: "worker-1" }, 400);
    assert.deepEqual(completed.metrics, { taskId: "one", workerId: "worker-1", queuedAt: 100, claimedAt: 200, startedAt: 250, completedAt: 400, queueWaitMs: 100, claimToStartMs: 50, claimToCompleteMs: 200, totalMs: 300 });
    assert.equal(completed.state.claims.length, 0);
  });

  it("rejects a completion from a worker whose lease already expired", () => {
    const admitted = admitWorkerTask(createWorkerPoolState(1), task("one"), "worker-1", 200, 10);
    assert.equal(admitted.admitted, true);
    if (!admitted.admitted) return;
    const running = startWorkerClaim(admitted.state, { taskId: "one", executionId: "execution:one", workerId: "worker-1" }, 205);
    // The lease died at 210. The allocator agrees this task is recoverable.
    assert.deepEqual(recoverExpiredWorkerClaims(running, 300).recoveredTaskIds, ["one"]);
    // So the zombie worker must not be able to close it out and emit throughput for it.
    assert.throws(() => completeWorkerClaim(running, { taskId: "one", executionId: "execution:one", workerId: "worker-1" }, 300), /WORKER_LEASE_EXPIRED/);
    // A live worker renews instead, and then completes normally.
    const renewed = renewWorkerLease(running, { taskId: "one", executionId: "execution:one", workerId: "worker-1" }, 208, 1_000);
    const completed = completeWorkerClaim(renewed, { taskId: "one", executionId: "execution:one", workerId: "worker-1" }, 300);
    assert.equal(completed.metrics.completedAt, 300);
    assert.equal(completed.state.claims.length, 0);
  });

  it("does not double-count a task that was re-admitted after its lease expired", () => {
    const first = admitWorkerTask(createWorkerPoolState(1), task("one"), "worker-1", 200, 10);
    assert.equal(first.admitted, true);
    if (!first.admitted) return;
    const running = startWorkerClaim(first.state, { taskId: "one", executionId: "execution:one", workerId: "worker-1" }, 205);
    const recovered = recoverExpiredWorkerClaims(running, 300);
    const second = admitWorkerTask(recovered.state, task("one"), "worker-2", 301, 1_000);
    assert.equal(second.admitted, true);
    if (!second.admitted) return;
    // worker-1 comes back from the dead holding its own stale snapshot.
    assert.throws(() => completeWorkerClaim(running, { taskId: "one", executionId: "execution:one", workerId: "worker-1" }, 400), /WORKER_LEASE_EXPIRED/);
    // And it cannot complete against the live state either: that claim belongs to worker-2.
    assert.throws(() => completeWorkerClaim(second.state, { taskId: "one", executionId: "execution:one", workerId: "worker-1" }, 400), /WORKER_IDENTITY_MISMATCH/);
  });

  it("refuses to hand a worker a protected or symbolic branch", () => {
    // A worker branch is a branch the worker creates and pushes. Admitting `main` here would make
    // the admission boundary itself the thing that hands out the branch the release path owns.
    for (const branchName of ["main", "master", "HEAD", "refs/heads/main", "codex/../main"]) {
      assert.throws(() => admitWorkerTask(createWorkerPoolState(1), task("one", { branchName }), "worker-1", 200, 1_000), /WORKER_TASK_INVALID/, branchName);
    }
    const ok = admitWorkerTask(createWorkerPoolState(1), task("one", { branchName: "codex/2117-worker" }), "worker-1", 200, 1_000);
    assert.equal(ok.admitted, true);
  });

  it("confines every worker workspace to the sandbox root", () => {
    // worktreePath is passed to `git worktree add` and `git worktree remove`, so an absolute path
    // or a traversal segment puts worker lifecycle side effects outside the sandbox.
    for (const worktreePath of ["../../../tmp/evil", "/etc/nusa", ".autopilot/worktrees/../../../root/.ssh", ".autopilot/worktrees/", "relative/elsewhere"]) {
      assert.throws(() => admitWorkerTask(createWorkerPoolState(1), task("one", { worktreePath }), "worker-1", 200, 1_000), /WORKER_TASK_INVALID/, worktreePath);
    }
    const ok = admitWorkerTask(createWorkerPoolState(1), task("one", { worktreePath: ".autopilot/worktrees/one" }), "worker-1", 200, 1_000);
    assert.equal(ok.admitted, true);
  });

  it("rejects persisted state carrying an escaped workspace or a protected branch", () => {
    // Recovery reads this state back. A state file that got past an older validator must not be
    // able to re-open capacity with a claim the current rules would never have admitted.
    const claim = (overrides: Record<string, unknown>) => ({
      schemaVersion: 1,
      maxWip: 1,
      claims: [{ task: { ...task("one"), ...overrides }, workerId: "worker-1", state: "RUNNING", claimedAt: 200, leaseExpiresAt: 1_200, startedAt: 205 }],
    });
    assert.throws(() => validateWorkerPoolState(claim({ branchName: "main" })), /WORKER_POOL_STATE_CORRUPT/);
    assert.throws(() => validateWorkerPoolState(claim({ worktreePath: "/etc/nusa" })), /WORKER_POOL_STATE_CORRUPT/);
    assert.doesNotThrow(() => validateWorkerPoolState(claim({})));
  });

  it("rejects corrupt persisted state instead of opening capacity", () => {
    assert.throws(() => validateWorkerPoolState({ schemaVersion: 1, maxWip: 2, claims: [{ bad: true }] }), /WORKER_POOL_STATE_CORRUPT/);
    assert.throws(() => validateWorkerPoolState({ schemaVersion: 1, maxWip: 0, claims: [] }), /WORKER_POOL_STATE_CORRUPT/);
  });
});
