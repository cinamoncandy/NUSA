import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acquireExecutionLease,
  createExecutionState,
  recoverExpiredLease,
} from "./autonomousExecutionState";

const identity = { cycleId: "cycle-ts", workItemId: "work-ts", executionId: "exec-ts", dedupeKey: "dedupe-ts" };

const ready = () => createExecutionState(identity);

describe("autonomous execution timestamp safety", () => {
  it("rejects unsafe, fractional, negative and non-finite lease inputs", () => {
    for (const now of [Number.MAX_SAFE_INTEGER + 1, 1.5, -1, Infinity, NaN]) {
      assert.throws(() => acquireExecutionLease(ready(), "runner", now, 1000), /LEASE_INVALID/);
    }
    for (const ttl of [Number.MAX_SAFE_INTEGER + 1, 1.5, 0, -1, Infinity, NaN]) {
      assert.throws(() => acquireExecutionLease(ready(), "runner", 1000, ttl), /LEASE_INVALID/);
    }
  });

  it("rejects expiry overflow beyond the safe integer range", () => {
    assert.throws(
      () => acquireExecutionLease(ready(), "runner", Number.MAX_SAFE_INTEGER - 10, 11),
      /LEASE_INVALID/,
    );
  });

  it("accepts the safe upper boundary when expiry remains ordered", () => {
    const leased = acquireExecutionLease(ready(), "runner", Number.MAX_SAFE_INTEGER - 10, 10);
    assert.equal(leased.lease?.expiresAt, Number.MAX_SAFE_INTEGER);
  });

  it("recovers exactly at expiry and rejects unsafe recovery timestamps", () => {
    const leased = acquireExecutionLease(ready(), "runner", 1000, 500);
    assert.equal(recoverExpiredLease(leased, 1499), leased);
    assert.equal(recoverExpiredLease(leased, 1500).status, "READY");
    for (const now of [1.5, -1, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
      assert.throws(() => recoverExpiredLease(leased, now), /RECOVERY_TIME_INVALID/);
    }
  });
});
