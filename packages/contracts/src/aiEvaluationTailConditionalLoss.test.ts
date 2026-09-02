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
    assert.equal((result as { value: number }).value, 45); // (50+40)/2
    assert.equal((result as { effectiveSampleSize: number }).effectiveSampleSize, 5);
  });

  it("collapses observations in the same group to the single worst representative", () => {
    const clustered: readonly TailLossObservation[] = [
      { eventId: "e1", groupId: "g1", loss: 10 },
      { eventId: "e2", groupId: "g1", loss: 90 }, // same cluster as e1, worse
      { eventId: "e3", groupId: "g2", loss: 20 },
    ];
    const result = computeWorstKMean(clustered, 1, 1);
    assert.equal(result.resolved, true);
    assert.equal((result as { effectiveSampleSize: number }).effectiveSampleSize, 2); // only 2 distinct groups
    assert.equal((result as { value: number }).value, 90); // g1's worst representative
  });

  it("does not let a highly-correlated cluster inflate effective sample size past distinct group count", () => {
    const heavilyClustered: readonly TailLossObservation[] = Array.from({ length: 20 }, (_, i) => ({
      eventId: `e${i}`, groupId: "g1", loss: 10 + i,
    }));
    const result = computeWorstKMean(heavilyClustered, 1, 5);
    assert.deepEqual(result, { resolved: false, reason: "INSUFFICIENT_EFFECTIVE_SAMPLE" });
  });

  it("fails closed when effective sample size is below the required minimum", () => {
    const result = computeWorstKMean(independentObservations(), 2, 10);
    assert.deepEqual(result, { resolved: false, reason: "INSUFFICIENT_EFFECTIVE_SAMPLE" });
  });

  it("fails closed when k exceeds the effective sample size, rather than clamping", () => {
    const result = computeWorstKMean(independentObservations(), 10, 1);
    assert.deepEqual(result, { resolved: false, reason: "INSUFFICIENT_EFFECTIVE_SAMPLE" });
  });

  it("fails closed on a non-positive k", () => {
    assert.deepEqual(computeWorstKMean(independentObservations(), 0, 1), { resolved: false, reason: "INVALID_PARAMETER" });
  });

  it("fails closed on an empty set", () => {
    assert.deepEqual(computeWorstKMean([], 1, 1), { resolved: false, reason: "EMPTY_SET" });
  });

  it("fails closed on a negative loss", () => {
    const invalid: readonly TailLossObservation[] = [{ eventId: "e1", groupId: "g1", loss: -5 }];
    assert.deepEqual(computeWorstKMean(invalid, 1, 1), { resolved: false, reason: "INVALID_OBSERVATION" });
  });

  it("fails closed on a duplicate eventId", () => {
    const duplicate: readonly TailLossObservation[] = [
      { eventId: "e1", groupId: "g1", loss: 10 },
      { eventId: "e1", groupId: "g2", loss: 20 },
    ];
    assert.deepEqual(computeWorstKMean(duplicate, 1, 1), { resolved: false, reason: "DUPLICATE_EVENT_ID" });
  });
});

describe("computeTailConditionalLoss", () => {
  it("computes the mean of the worst ceil(alpha * effectiveSampleSize) losses", () => {
    // 5 groups, alpha=0.4 -> ceil(2) = 2 worst -> (50+40)/2 = 45
    const result = computeTailConditionalLoss(independentObservations(), 0.4, 1);
    assert.equal(result.resolved, true);
    assert.equal((result as { value: number }).value, 45);
  });

  it("uses at least 1 event even for a very small alpha", () => {
    const result = computeTailConditionalLoss(independentObservations(), 0.01, 1);
    assert.equal(result.resolved, true);
    assert.equal((result as { value: number }).value, 50); // worst single loss
  });

  it("fails closed on alpha out of (0, 1]", () => {
    assert.deepEqual(computeTailConditionalLoss(independentObservations(), 0, 1), { resolved: false, reason: "INVALID_PARAMETER" });
    assert.deepEqual(computeTailConditionalLoss(independentObservations(), 1.5, 1), { resolved: false, reason: "INVALID_PARAMETER" });
  });

  it("fails closed when the effective sample size is below the required minimum", () => {
    const result = computeTailConditionalLoss(independentObservations(), 0.4, 10);
    assert.deepEqual(result, { resolved: false, reason: "INSUFFICIENT_EFFECTIVE_SAMPLE" });
  });

  it("fails closed on an empty set", () => {
    assert.deepEqual(computeTailConditionalLoss([], 0.05, 1), { resolved: false, reason: "EMPTY_SET" });
  });
});
