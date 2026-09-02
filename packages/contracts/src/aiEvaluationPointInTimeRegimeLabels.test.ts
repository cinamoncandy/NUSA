import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePointInTimeRegimeLabel, isPointInTimeRegimeLabelConsistent, type RegimeLabelAssignment } from "./aiEvaluationPointInTimeRegimeLabels";

function assignments(): readonly RegimeLabelAssignment[] {
  return [
    // Period [1000, 5000) was first classified BULL at publishedAt=1000 (real-time-ish),
    // then reclassified HIGH_VOLATILITY at publishedAt=4000 once more data came in,
    // then reclassified again to BEAR at publishedAt=6000 -- with hindsight, after the period ended.
    { assignmentId: "a1", regimeId: "BULL", periodStart: 1_000, periodEnd: 5_000, publishedAt: 1_000 },
    { assignmentId: "a2", regimeId: "HIGH_VOLATILITY", periodStart: 1_000, periodEnd: 5_000, publishedAt: 4_000 },
    { assignmentId: "a3", regimeId: "BEAR", periodStart: 1_000, periodEnd: 5_000, publishedAt: 6_000 },
  ];
}

describe("resolvePointInTimeRegimeLabel", () => {
  it("resolves the classification published at or before predictionTime, most recent such", () => {
    const result = resolvePointInTimeRegimeLabel(2_000, assignments());
    assert.deepEqual(result, { resolved: true, assignmentId: "a1", regimeId: "BULL", publishedAt: 1_000 });
  });

  it("picks up a reclassification once it becomes eligible (published at or before predictionTime)", () => {
    const result = resolvePointInTimeRegimeLabel(4_500, assignments());
    assert.deepEqual(result, { resolved: true, assignmentId: "a2", regimeId: "HIGH_VOLATILITY", publishedAt: 4_000 });
  });

  it("never returns a hindsight reclassification published after predictionTime, even for a later predictionTime within the same period bounds", () => {
    // predictionTime=4_500 is still within [1000,5000) but a3 (BEAR) published at 6000 -- after
    // this predictionTime -- must never be returned, even though it's now the "final" label.
    const result = resolvePointInTimeRegimeLabel(4_500, assignments());
    assert.notEqual((result as { regimeId: string }).regimeId, "BEAR");
  });

  it("fails closed when no classification of the covering period had been published yet", () => {
    const result = resolvePointInTimeRegimeLabel(500, assignments());
    assert.deepEqual(result, { resolved: false, reason: "NO_LABEL_PUBLISHED_AT_PREDICTION_TIME" });
  });

  it("fails closed for a predictionTime outside every period", () => {
    const result = resolvePointInTimeRegimeLabel(9_000, assignments());
    assert.deepEqual(result, { resolved: false, reason: "NO_LABEL_PUBLISHED_AT_PREDICTION_TIME" });
  });

  it("fails closed as ambiguous when two classifications of the same period publish at the same instant with different regimeId", () => {
    const simultaneous: readonly RegimeLabelAssignment[] = [
      { assignmentId: "a1", regimeId: "BULL", periodStart: 1_000, periodEnd: 5_000, publishedAt: 1_000 },
      { assignmentId: "a2", regimeId: "BEAR", periodStart: 1_000, periodEnd: 5_000, publishedAt: 1_000 },
    ];
    assert.deepEqual(resolvePointInTimeRegimeLabel(2_000, simultaneous), { resolved: false, reason: "AMBIGUOUS_SIMULTANEOUS_LABELS" });
  });

  it("fails closed on an invalid predictionTime", () => {
    assert.deepEqual(resolvePointInTimeRegimeLabel(Number.NaN, assignments()), { resolved: false, reason: "INVALID_PREDICTION_TIME" });
  });

  it("fails closed on an empty assignment set", () => {
    assert.deepEqual(resolvePointInTimeRegimeLabel(2_000, []), { resolved: false, reason: "INVALID_ASSIGNMENT_SET" });
  });

  it("fails closed on an inverted period", () => {
    const inverted: readonly RegimeLabelAssignment[] = [{ assignmentId: "a1", regimeId: "BULL", periodStart: 5_000, periodEnd: 1_000, publishedAt: 1_000 }];
    assert.deepEqual(resolvePointInTimeRegimeLabel(2_000, inverted), { resolved: false, reason: "INVALID_ASSIGNMENT_SET" });
  });

  it("fails closed on a duplicate assignmentId", () => {
    const duplicate: readonly RegimeLabelAssignment[] = [
      { assignmentId: "a1", regimeId: "BULL", periodStart: 1_000, periodEnd: 5_000, publishedAt: 1_000 },
      { assignmentId: "a1", regimeId: "BEAR", periodStart: 1_000, periodEnd: 5_000, publishedAt: 2_000 },
    ];
    assert.deepEqual(resolvePointInTimeRegimeLabel(3_000, duplicate), { resolved: false, reason: "INVALID_ASSIGNMENT_SET" });
  });
});

describe("isPointInTimeRegimeLabelConsistent", () => {
  it("is true when every claim matches the independently resolved point-in-time label", () => {
    const claims = [{ predictionTime: 2_000, assignmentId: "a1" }, { predictionTime: 4_500, assignmentId: "a2" }];
    assert.equal(isPointInTimeRegimeLabelConsistent(claims, assignments()), true);
  });

  it("is false when a claim uses a hindsight-reclassified label (future leakage)", () => {
    const claims = [{ predictionTime: 4_500, assignmentId: "a3" }]; // a3 published after 4_500
    assert.equal(isPointInTimeRegimeLabelConsistent(claims, assignments()), false);
  });

  it("is false for an empty claim set rather than vacuously true", () => {
    assert.equal(isPointInTimeRegimeLabelConsistent([], assignments()), false);
  });
});
