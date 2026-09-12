import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acquireExecutionLease,
  applyExecutionHold,
  authorizeMergeReady,
  clearExecutionHold,
  createExecutionState,
  isDuplicateExecution,
  recoverExpiredLease,
  transitionExecution,
} from "./autonomousExecutionState";
import type { AutonomousExecutionState, AutonomousExecutionStatus, ExecutionHold, HoldClearance, MergeReadinessProof } from "./autonomousExecutionState";

const identity = { cycleId: "cycle-1", workItemId: "work-1", executionId: "exec-1", dedupeKey: "dedupe-1" };
const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const stateWithStatus = (status: AutonomousExecutionStatus): AutonomousExecutionState =>
  Object.freeze({ ...createExecutionState(identity), status });
const hold: ExecutionHold = Object.freeze({
  holdId: "hold-1876",
  prNumber: 1854,
  headSha: HEAD,
  baseSha: BASE,
  reason: "GLOBAL_RELEASE_FREEZE",
  source: "core-release-freeze",
});
const clearance = (overrides: Partial<HoldClearance> = {}): HoldClearance => Object.freeze({
  holdId: hold.holdId,
  prNumber: hold.prNumber,
  headSha: hold.headSha,
  baseSha: hold.baseSha,
  clearedBy: "core-explicit-clear",
  globalReleaseFreeze: false,
  blockedHuman: false,
  reworkRequired: false,
  ...overrides,
});
const mergeProof = (overrides: Partial<MergeReadinessProof> = {}): MergeReadinessProof => Object.freeze({
  prNumber: 1854,
  headSha: HEAD,
  baseSha: BASE,
  auditedHeadSha: HEAD,
  auditedBaseSha: BASE,
  auditPassed: true,
  globalReleaseFreeze: false,
  blockedHuman: false,
  reworkRequired: false,
  ...overrides,
});

describe("autonomous execution state", () => {
  it("supports discovery and ranking before a work item is ready", () => {
    const discovered = transitionExecution(stateWithStatus("DISCOVERED"), "RANKED");
    assert.equal(discovered.status, "RANKED");
    assert.equal(transitionExecution(discovered, "READY").status, "READY");
  });

  it("requires independent Audit between CI success and merge readiness", () => {
    const ready = stateWithStatus("READY");
    const leased = acquireExecutionLease(ready, "runner-1", 1000, 500);
    const implementing = transitionExecution(transitionExecution(leased, "CODING_DISPATCHED"), "IMPLEMENTING");
    const commitProduced = transitionExecution(implementing, "COMMIT_PRODUCED");
    const prOpen = transitionExecution(commitProduced, "PR_OPEN");
    const ciRunning = transitionExecution(prOpen, "CI_RUNNING");
    const ciPassed = transitionExecution(ciRunning, "CI_PASSED");
    assert.throws(() => transitionExecution(ciPassed, "MERGE_READY"), /TRANSITION_INVALID/);
    const audit = transitionExecution(ciPassed, "AUDIT");
    const mergeReady = authorizeMergeReady(audit, mergeProof());
    const merging = transitionExecution(mergeReady, "MERGING");
    const merged = transitionExecution(merging, "MERGED");
    const outcomePending = transitionExecution(merged, "OUTCOME_PENDING");
    const evaluating = transitionExecution(outcomePending, "OUTCOME_EVALUATING");
    assert.equal(transitionExecution(evaluating, "REGRESSION").status, "REGRESSION");
    assert.equal(transitionExecution(evaluating, "REWORK_QUEUED").status, "REWORK_QUEUED");
    assert.equal(transitionExecution(evaluating, "ROLLBACK_RECOMMENDED").status, "ROLLBACK_RECOMMENDED");
    assert.equal(transitionExecution(transitionExecution(evaluating, "NEUTRAL"), "FINALIZED").status, "FINALIZED");
  });

  it("keeps explicit HOLD sticky across CI/Audit/event/replay until an exact bound clearance", () => {
    const ciPassed = stateWithStatus("CI_PASSED");
    const held = applyExecutionHold(ciPassed, hold);
    assert.equal(held.status, "HOLD");
    assert.equal(held.mutationAllowed, false);
    assert.throws(() => transitionExecution(held, "AUDIT"), /HOLD_ACTIVE/);
    assert.equal(applyExecutionHold(held, hold), held, "duplicate/replayed HOLD must be idempotent");
    assert.throws(() => clearExecutionHold(held, clearance({ headSha: "c".repeat(40) })), /HOLD_CLEAR_STALE/);
    const cleared = clearExecutionHold(held, clearance());
    assert.equal(cleared.status, "CI_PASSED");
    assert.throws(() => clearExecutionHold(cleared, clearance()), /HOLD_NOT_ACTIVE/);
  });

  it("does not clear HOLD while global freeze, human block, or rework is active", () => {
    const held = applyExecutionHold(stateWithStatus("CI_PASSED"), hold);
    assert.throws(() => clearExecutionHold(held, clearance({ globalReleaseFreeze: true })), /HOLD_CLEAR_BLOCKED/);
    assert.throws(() => clearExecutionHold(held, clearance({ blockedHuman: true })), /HOLD_CLEAR_BLOCKED/);
    assert.throws(() => clearExecutionHold(held, clearance({ reworkRequired: true })), /HOLD_CLEAR_BLOCKED/);
  });

  it("blocks merge readiness on freeze, human block, rework, failed Audit, or stale head/base evidence", () => {
    const audit = stateWithStatus("AUDIT");
    assert.throws(() => authorizeMergeReady(audit, mergeProof({ globalReleaseFreeze: true })), /MERGE_READY_BLOCKED/);
    assert.throws(() => authorizeMergeReady(audit, mergeProof({ blockedHuman: true })), /MERGE_READY_BLOCKED/);
    assert.throws(() => authorizeMergeReady(audit, mergeProof({ reworkRequired: true })), /MERGE_READY_BLOCKED/);
    assert.throws(() => authorizeMergeReady(audit, mergeProof({ auditPassed: false })), /MERGE_READY_BLOCKED/);
    assert.throws(() => authorizeMergeReady(audit, mergeProof({ auditedHeadSha: "c".repeat(40) })), /MERGE_PROOF_STALE/);
    assert.throws(() => authorizeMergeReady(audit, mergeProof({ auditedBaseSha: "d".repeat(40) })), /MERGE_PROOF_STALE/);
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

  it("requires a lease before provider-neutral coding dispatch", () => {
    const ready = createExecutionState(identity);
    assert.throws(() => transitionExecution({ ...ready, status: "LEASED" }, "CODING_DISPATCHED"), /LEASE_REQUIRED/);
  });

  it("acquires a bounded lease and permits provider-neutral coding dispatch", () => {
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
    assert.equal(authorizeMergeReady(stateWithStatus("AUDIT"), mergeProof()).mutationAllowed, false);
  });
});
