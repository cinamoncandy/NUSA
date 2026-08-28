import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acquireExecutionLease,
  createExecutionState,
  isDuplicateExecution,
  recoverExpiredLease,
  transitionExecution,
} from "./autonomousExecutionState";

const identity = { cycleId: "cycle-1", workItemId: "work-1", executionId: "exec-1", dedupeKey: "dedupe-1" };

describe("autonomous execution state", () => {
  it("creates a fail-closed READY state", () => {
    assert.deepEqual(createExecutionState(identity), { ...identity, status: "READY", lease: null, mutationAllowed: false });
  });

  it("rejects empty identity fields", () => {
    assert.throws(() => createExecutionState({ ...identity, executionId: "" }), /IDENTITY_INVALID/);
  });

  it("requires a lease before dispatch", () => {
    const ready = createExecutionState(identity);
    assert.throws(() => transitionExecution({ ...ready, status: "LEASED" }, "CODEX_DISPATCHED"), /LEASE_REQUIRED/);
  });

  it("acquires a bounded lease and permits dispatch", () => {
    const leased = acquireExecutionLease(createExecutionState(identity), "runner-1", 1000, 500);
    assert.equal(leased.status, "LEASED");
    assert.equal(leased.lease?.expiresAt, 1500);
    assert.equal(transitionExecution(leased, "CODEX_DISPATCHED").status, "CODEX_DISPATCHED");
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
    assert.equal(transitionExecution(leased, "CODEX_DISPATCHED").mutationAllowed, false);
  });
});
