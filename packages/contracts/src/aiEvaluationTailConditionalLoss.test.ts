import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeWorstKMean, computeTailConditionalLoss, type TailLossObservation } from "./aiEvaluationTailConditionalLoss";

function independentObservations(): readonly TailLossObservation[] {
  return [
    { eventId: "e1", groupId: "g1", loss: 10 },
    { eventId: "e2", groupId: "g2", loss: 20 },
    { eventId: "e3", groupId: "g3", loss: 30 },
    { eventId: "e4", groupId: "g4", loss: 40 },
    { eventId: "e5", groupId: "g5", loss: 50 },
  ];
}

describe("computeWorstKMean", () => {
  it("averages the k worst losses", () => {
    const result = computeWorstKMean(independentObservations(), 2, 1);
    assert.equal(result.resolved, true);
    assert.equal((result as { value: number }).value, 45);
    assert.equal((result as { effectiveSampleSize: number }).effectiveSampleSize, 5);
  });
  it("collapses observations in the same group to the single worst representative", () => {
    const clustered: readonly TailLossObservation[] = [
      { eventId: "e1", groupId: "g1", loss: 10 },
      { eventId: "e2", groupId: "g1", loss: 90 },
      { eventId: "e3", groupId: "g2", loss: 20 },
    ];
    const result = computeWorstKMean(clustered, 1, 1);
    assert.equal(result.resolved, true);
    assert.equal((result as { effectiveSampleSize: number }).effectiveSampleSize, 2);
    assert.equal((result as { value: number }).value, 90);
  });
  it("does not let a correlated cluster inflate effective sample size", () => {
    const clustered: readonly TailLossObservation[] = Array.from({ length: 20 }, (_, i) => ({ eventId: `e${i}`, groupId: "g1", loss: 10 + i }));
    assert.deepEqual(computeWorstKMean(clustered, 1, 5), { resolved: false, reason: "INSUFFICIENT_EFFECTIVE_SAMPLE" });
  });
  it("fails closed when effective sample size is below minimum", () => {
    assert.deepEqual(computeWorstKMean(independentObservations(), 2, 10), { resolved: false, reason: "INSUFFICIENT_EFFECTIVE_SAMPLE" });
  });
  it("fails closed when k exceeds effective sample size", () => {
    assert.deepEqual(computeWorstKMean(independentObservations(), 10, 1), { resolved: false, reason: "INSUFFICIENT_EFFECTIVE_SAMPLE" });
  });
  it("fails closed on non-positive k", () => {
    assert.deepEqual(computeWorstKMean(independentObservations(), 0, 1), { resolved: false, reason: "INVALID_PARAMETER" });
  });
  it("fails closed on empty set", () => {
    assert.deepEqual(computeWorstKMean([], 1, 1), { resolved: false, reason: "EMPTY_SET" });
  });
  it("fails closed on negative loss", () => {
    assert.deepEqual(computeWorstKMean([{ eventId: "e1", groupId: "g1", loss: -5 }], 1, 1), { resolved: false, reason: "INVALID_OBSERVATION" });
  });
  it("fails closed on duplicate eventId", () => {
    const duplicate: readonly TailLossObservation[] = [
      { eventId: "e1", groupId: "g1", loss: 10 },
      { eventId: "e1", groupId: "g2", loss: 20 },
    ];
    assert.deepEqual(computeWorstKMean(duplicate, 1, 1), { resolved: false, reason: "DUPLICATE_EVENT_ID" });
  });
});

describe("computeTailConditionalLoss", () => {
  it("computes the mean of the worst ceil(alpha * effectiveSampleSize) losses", () => {
    const result = computeTailConditionalLoss(independentObservations(), 0.4, 1);
    assert.equal(result.resolved, true);
    assert.equal((result as { value: number }).value, 45);
  });
  it("uses at least one event for a very small alpha", () => {
    const result = computeTailConditionalLoss(independentObservations(), 0.01, 1);
    assert.equal(result.resolved, true);
    assert.equal((result as { value: number }).value, 50);
  });
  it("fails closed on alpha out of range", () => {
    assert.deepEqual(computeTailConditionalLoss(independentObservations(), 0, 1), { resolved: false, reason: "INVALID_PARAMETER" });
    assert.deepEqual(computeTailConditionalLoss(independentObservations(), 1.5, 1), { resolved: false, reason: "INVALID_PARAMETER" });
  });
  it("fails closed when effective sample size is below minimum", () => {
    assert.deepEqual(computeTailConditionalLoss(independentObservations(), 0.4, 10), { resolved: false, reason: "INSUFFICIENT_EFFECTIVE_SAMPLE" });
  });
  it("fails closed on empty set", () => {
    assert.deepEqual(computeTailConditionalLoss([], 0.05, 1), { resolved: false, reason: "EMPTY_SET" });
  });
});
