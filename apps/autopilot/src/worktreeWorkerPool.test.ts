import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { admitWorkerTask, completeWorkerClaim, createWorkerPoolState, recoverExpiredWorkerClaims, startWorkerClaim, validateWorkerPoolState } from "./worktreeWorkerPool";

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

  it("rejects corrupt persisted state instead of opening capacity", () => {
    assert.throws(() => validateWorkerPoolState({ schemaVersion: 1, maxWip: 2, claims: [{ bad: true }] }), /WORKER_POOL_STATE_CORRUPT/);
    assert.throws(() => validateWorkerPoolState({ schemaVersion: 1, maxWip: 0, claims: [] }), /WORKER_POOL_STATE_CORRUPT/);
  });
});
