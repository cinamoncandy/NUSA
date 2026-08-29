import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acquireExecutionLease,
  createExecutionState,
  isDuplicateExecution,
  recoverExpiredLease,
  transitionExecution,
} from "./autonomousExecutionState";
import type { AutonomousExecutionState, AutonomousExecutionStatus } from "./autonomousExecutionState";

const identity = { cycleId: "cycle-1", workItemId: "work-1", executionId: "exec-1", dedupeKey: "dedupe-1" };
const stateWithStatus = (status: AutonomousExecutionStatus): AutonomousExecutionState =>
  Object.freeze({ ...createExecutionState(identity), status });

describe("autonomous execution state", () => {
  it("supports discovery and ranking before a work item is ready", () => {
    const discovered = transitionExecution(stateWithStatus("DISCOVERED"), "RANKED");
    assert.equal(discovered.status, "RANKED");
    assert.equal(transitionExecution(discovered, "READY").status, "READY");
  });

  it("covers implementation, merge, and bounded rework transitions", () => {
    const ready = stateWithStatus("READY");
    const leased = acquireExecutionLease(ready, "runner-1", 1000, 500);
    const implementing = transitionExecution(transitionExecution(leased, "CODING_DISPATCHED"), "IMPLEMENTING");
    const commitProduced = transitionExecution(implementing, "COMMIT_PRODUCED");
    const prOpen = transitionExecution(commitProduced, "PR_OPEN");
    const ciRunning = transitionExecution(prOpen, "CI_RUNNING");
    const ciPassed = transitionExecution(ciRunning, "CI_PASSED");
    const merging = transitionExecution(transitionExecution(ciPassed, "MERGE_READY"), "MERGING");
    const merged = transitionExecution(merging, "MERGED");
    const outcomePending = transitionExecution(merged, "OUTCOME_PENDING");
    const evaluating = transitionExecution(outcomePending, "OUTCOME_EVALUATING");
    assert.equal(transitionExecution(evaluating, "REGRESSION").status, "REGRESSION");
    assert.equal(transitionExecution(evaluating, "REWORK_QUEUED").status, "REWORK_QUEUED");
    assert.equal(transitionExecution(evaluating, "ROLLBACK_RECOMMENDED").status, "ROLLBACK_RECOMMENDED");
    assert.equal(transitionExecution(transitionExecution(evaluating, "NEUTRAL"), "FINALIZED").status, "FINALIZED");
  });

  it("keeps implementation blocks and rollback recommendations fail-closed", () => {
    const leased = acquireExecutionLease(createExecutionState(identity), "runner-1", 1000, 500);
    const blocked = transitionExecution(transitionExecution(leased, "CODING_DISPATCHED"), "IMPLEMENTATION_BLOCKED");
    assert.equal(transitionExecution(blocked, "REWORK_QUEUED").status, "REWORK_QUEUED");
    const recommendation = transitionExecution(stateWithStatus("ROLLBACK_RECOMMENDED"), "HUMAN_ONLY");
    assert.equal(recommendation.mutationAllowed, false);
  });

  it("creates a fail-closed READY state", () => {
    assert.deepEqual(createExecutionState(identity), { ...identity, status: "READY", lease: null, mutationAllowed: false });
  });

  it("rejects empty identity fields", () => {
    assert.throws(() => createExecutionState({ ...identity, executionId: "" }), /IDENTITY_INVALID/);
  });

  it("requires a lease before dispatch", () => {
    const ready = createExecutionState(identity);
    assert.throws(() => transitionExecution({ ...ready, status: "LEASED" }, "CODING_DISPATCHED"), /LEASE_REQUIRED/);
  });

  it("acquires a bounded lease and permits provider-neutral dispatch", () => {
    const leased = acquireExecutionLease(createExecutionState(identity), "runner-1", 1000, 500);
    assert.equal(leased.status, "LEASED");
    assert.equal(leased.lease?.expiresAt, 1500);
    assert.equal(transitionExecution(leased, "CODING_DISPATCHED").status, "CODING_DISPATCHED");
  });

  it("recovers only expired leases", () => {
    const leased = acquireExecutionLease(createExecutionState(identity), "runner-1", 1000, 500);
    assert.equal(recoverExpiredLease(leased, 1499), leased);
    assert.equal(recoverExpiredLease(leased, 1500).status, "READY");
  });

  it("rejects illegal state transitions", () => {
    assert.throws(() => transitionExecution(createExecutionState(identity), "MERGED"), /TRANSITION_INVALID/);
  });

  it("dedupes by execution id, dedupe key, or cycle/work pair", () => {
    const active = [createExecutionState(identity)];
    assert.equal(isDuplicateExecution(active, { ...identity, executionId: "other" }), true);
    assert.equal(isDuplicateExecution(active, { ...identity, dedupeKey: "other" }), true);
    assert.equal(isDuplicateExecution(active, { cycleId: "other", workItemId: "other", executionId: "other", dedupeKey: "other" }), false);
  });

  it("never grants mutation authority", () => {
    const leased = acquireExecutionLease(createExecutionState(identity), "runner-1", 1000, 500);
    assert.equal(leased.mutationAllowed, false);
    assert.equal(transitionExecution(leased, "CODING_DISPATCHED").mutationAllowed, false);
  });
});
