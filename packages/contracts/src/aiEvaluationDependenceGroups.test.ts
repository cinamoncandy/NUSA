import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupByDependence, isDependenceGroupConsistent, type DependenceGroupCandidate } from "./aiEvaluationDependenceGroups";

function candidate(overrides: Partial<DependenceGroupCandidate> = {}): DependenceGroupCandidate {
  return { predictionId: "p1", targetId: "BTC-USD", outcomeWindowStart: 0, outcomeWindowEnd: 100, ...overrides };
}

describe("groupByDependence", () => {
  it("treats non-overlapping predictions on the same target as independent groups", () => {
    const result = groupByDependence([
      candidate({ predictionId: "p1", outcomeWindowStart: 0, outcomeWindowEnd: 100 }),
      candidate({ predictionId: "p2", outcomeWindowStart: 200, outcomeWindowEnd: 300 }),
    ]);
    assert.equal(result.groups.length, 2);
    assert.equal(result.effectiveSampleSize, 2);
    assert.equal(result.rawSampleSize, 2);
  });

  it("clusters directly overlapping predictions on the same target into one group", () => {
    const result = groupByDependence([
      candidate({ predictionId: "p1", outcomeWindowStart: 0, outcomeWindowEnd: 100 }),
      candidate({ predictionId: "p2", outcomeWindowStart: 50, outcomeWindowEnd: 150 }),
    ]);
    assert.equal(result.groups.length, 1);
    assert.deepEqual(result.groups[0].memberPredictionIds, ["p1", "p2"]);
    assert.equal(result.effectiveSampleSize, 1);
    assert.equal(result.rawSampleSize, 2);
  });

  it("clusters transitively overlapping predictions (chain) into one group even without pairwise overlap", () => {
    const result = groupByDependence([
      candidate({ predictionId: "p1", outcomeWindowStart: 0, outcomeWindowEnd: 100 }),
      candidate({ predictionId: "p2", outcomeWindowStart: 90, outcomeWindowEnd: 200 }),
      candidate({ predictionId: "p3", outcomeWindowStart: 190, outcomeWindowEnd: 300 }),
    ]);
    // p1/p3 do not overlap directly (0-100 vs 190-300), but the chain through p2 links them.
    assert.equal(result.groups.length, 1);
    assert.deepEqual(result.groups[0].memberPredictionIds, ["p1", "p2", "p3"]);
  });

  it("never groups overlapping predictions on different targets together", () => {
    const result = groupByDependence([
      candidate({ predictionId: "p1", targetId: "BTC-USD", outcomeWindowStart: 0, outcomeWindowEnd: 100 }),
      candidate({ predictionId: "p2", targetId: "ETH-USD", outcomeWindowStart: 0, outcomeWindowEnd: 100 }),
    ]);
    assert.equal(result.groups.length, 2);
    assert.equal(result.effectiveSampleSize, 2);
  });

  it("returns an empty result for an empty candidate set", () => {
    const result = groupByDependence([]);
    assert.deepEqual(result.groups, []);
    assert.equal(result.effectiveSampleSize, 0);
    assert.equal(result.rawSampleSize, 0);
  });

  it("fails closed on a duplicate predictionId", () => {
    assert.throws(
      () => groupByDependence([candidate({ predictionId: "p1" }), candidate({ predictionId: "p1", outcomeWindowStart: 200, outcomeWindowEnd: 300 })]),
      /DEPENDENCE_GROUP_DUPLICATE_PREDICTION_ID/,
    );
  });

  it("fails closed on an inverted outcome window", () => {
    assert.throws(
      () => groupByDependence([candidate({ outcomeWindowStart: 100, outcomeWindowEnd: 0 })]),
      /DEPENDENCE_GROUP_WINDOW_INVALID/,
    );
  });

  it("fails closed on a missing predictionId or targetId", () => {
    assert.throws(() => groupByDependence([candidate({ predictionId: "" })]));
    assert.throws(() => groupByDependence([candidate({ targetId: "" })]));
  });
});

describe("isDependenceGroupConsistent", () => {
  it("is true for a group whose members match the candidate set and share the group's targetId", () => {
    const candidates = [candidate({ predictionId: "p1" }), candidate({ predictionId: "p2" })];
    const result = groupByDependence(candidates);
    assert.equal(isDependenceGroupConsistent(result.groups[0], candidates), true);
  });

  it("is false when a claimed member is not present in the candidate set", () => {
    const group = { groupId: "g1", targetId: "BTC-USD", memberPredictionIds: ["p1", "ghost"] };
    assert.equal(isDependenceGroupConsistent(group, [candidate({ predictionId: "p1" })]), false);
  });

  it("is false when a member's targetId does not match the group's targetId", () => {
    const group = { groupId: "g1", targetId: "BTC-USD", memberPredictionIds: ["p1"] };
    assert.equal(isDependenceGroupConsistent(group, [candidate({ predictionId: "p1", targetId: "ETH-USD" })]), false);
  });
});
