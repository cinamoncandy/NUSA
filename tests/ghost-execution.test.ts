import assert from "node:assert/strict";
import test from "node:test";
import { simulateGhostExecution } from "../apps/desktop/src/cloud/ghostExecution";
import type { AbstentionAssessment } from "../apps/desktop/src/cloud/abstentionEngine";

const proceed: AbstentionAssessment = Object.freeze({
  schemaVersion: 1,
  asOf: 100,
  decision: "PROCEED_RESEARCH",
  netExpectedEdge: 0.01,
  effectiveMinimumConfidence: 0.6,
  reasons: Object.freeze([]),
  sourceDatasetIds: Object.freeze(["dataset-a"]),
});

const abstain: AbstentionAssessment = Object.freeze({ ...proceed, decision: "ABSTAIN", reasons: Object.freeze(["STRESSED_REGIME"]) });

test("simulates long ghost execution with fees and slippage", () => {
  const result = simulateGhostExecution({ abstention: proceed, side: "LONG", entryObservedPrice: 100, exitObservedPrice: 110, entryTime: 1_000, exitTime: 2_000, feeRate: 0.001, slippageRate: 0.001 });
  assert.equal(result.status, "SIMULATED");
  assert.equal(result.holdingPeriodMs, 1_000);
  assert.equal(result.sourceDatasetIds[0], "dataset-a");
  assert.ok((result.netReturn ?? 0) < (result.grossReturn ?? 0));
});

test("skips simulation when abstention blocks research", () => {
  const result = simulateGhostExecution({ abstention: abstain, side: "LONG", entryObservedPrice: 100, exitObservedPrice: 110, entryTime: 1_000, exitTime: 2_000, feeRate: 0.001, slippageRate: 0.001 });
  assert.equal(result.status, "SKIPPED");
  assert.deepEqual(result.reasons, ["ABSTENTION_BLOCKED"]);
});

test("supports short ghost execution", () => {
  const result = simulateGhostExecution({ abstention: proceed, side: "SHORT", entryObservedPrice: 100, exitObservedPrice: 90, entryTime: 1_000, exitTime: 2_000, feeRate: 0.001, slippageRate: 0.001 });
  assert.equal(result.status, "SIMULATED");
  assert.ok((result.netReturn ?? 0) > 0);
});

test("fails closed on invalid horizon or costs", () => {
  assert.throws(() => simulateGhostExecution({ abstention: proceed, side: "LONG", entryObservedPrice: 100, exitObservedPrice: 110, entryTime: 2_000, exitTime: 1_000, feeRate: 0.001, slippageRate: 0.001 }), /exitTime/);
  assert.throws(() => simulateGhostExecution({ abstention: proceed, side: "LONG", entryObservedPrice: 100, exitObservedPrice: 110, entryTime: 1_000, exitTime: 2_000, feeRate: -0.1, slippageRate: 0.001 }), /feeRate/);
});
