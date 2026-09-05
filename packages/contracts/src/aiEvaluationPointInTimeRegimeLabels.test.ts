import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePointInTimeRegimeLabel, isPointInTimeRegimeLabelConsistent, type RegimeLabelAssignment } from "./aiEvaluationPointInTimeRegimeLabels";

function assignments(): readonly RegimeLabelAssignment[] {
  return [
    { assignmentId: "a1", regimeId: "BULL", periodStart: 1_000, periodEnd: 5_000, publishedAt: 1_000 },
    { assignmentId: "a2", regimeId: "HIGH_VOLATILITY", periodStart: 1_000, periodEnd: 5_000, publishedAt: 4_000 },
    { assignmentId: "a3", regimeId: "BEAR", periodStart: 1_000, periodEnd: 5_000, publishedAt: 6_000 },
  ];
}

describe("resolvePointInTimeRegimeLabel", () => {
  it("resolves the classification published at or before predictionTime, most recent such", () => {
    assert.deepEqual(resolvePointInTimeRegimeLabel(2_000, assignments()), { resolved: true, assignmentId: "a1", regimeId: "BULL", publishedAt: 1_000 });
  });
  it("picks up a reclassification once it becomes eligible", () => {
    assert.deepEqual(resolvePointInTimeRegimeLabel(4_500, assignments()), { resolved: true, assignmentId: "a2", regimeId: "HIGH_VOLATILITY", publishedAt: 4_000 });
  });
  it("never returns a hindsight reclassification published after predictionTime", () => {
    const result = resolvePointInTimeRegimeLabel(4_500, assignments());
    assert.notEqual((result as { regimeId: string }).regimeId, "BEAR");
  });
  it("fails closed when no classification had been published yet", () => {
    assert.deepEqual(resolvePointInTimeRegimeLabel(500, assignments()), { resolved: false, reason: "NO_LABEL_PUBLISHED_AT_PREDICTION_TIME" });
  });
  it("fails closed outside every period", () => {
    assert.deepEqual(resolvePointInTimeRegimeLabel(9_000, assignments()), { resolved: false, reason: "NO_LABEL_PUBLISHED_AT_PREDICTION_TIME" });
  });
  it("fails closed on simultaneous conflicting labels", () => {
    const simultaneous: readonly RegimeLabelAssignment[] = [
      { assignmentId: "a1", regimeId: "BULL", periodStart: 1_000, periodEnd: 5_000, publishedAt: 1_000 },
      { assignmentId: "a2", regimeId: "BEAR", periodStart: 1_000, periodEnd: 5_000, publishedAt: 1_000 },
    ];
    assert.deepEqual(resolvePointInTimeRegimeLabel(2_000, simultaneous), { resolved: false, reason: "AMBIGUOUS_SIMULTANEOUS_LABELS" });
  });
  it("fails closed on invalid predictionTime", () => {
    assert.deepEqual(resolvePointInTimeRegimeLabel(Number.NaN, assignments()), { resolved: false, reason: "INVALID_PREDICTION_TIME" });
  });
  it("fails closed on empty assignment set", () => {
    assert.deepEqual(resolvePointInTimeRegimeLabel(2_000, []), { resolved: false, reason: "INVALID_ASSIGNMENT_SET" });
  });
  it("fails closed on inverted period", () => {
    const inverted: readonly RegimeLabelAssignment[] = [{ assignmentId: "a1", regimeId: "BULL", periodStart: 5_000, periodEnd: 1_000, publishedAt: 1_000 }];
    assert.deepEqual(resolvePointInTimeRegimeLabel(2_000, inverted), { resolved: false, reason: "INVALID_ASSIGNMENT_SET" });
  });
  it("fails closed on duplicate assignmentId", () => {
    const duplicate: readonly RegimeLabelAssignment[] = [
      { assignmentId: "a1", regimeId: "BULL", periodStart: 1_000, periodEnd: 5_000, publishedAt: 1_000 },
      { assignmentId: "a1", regimeId: "BEAR", periodStart: 1_000, periodEnd: 5_000, publishedAt: 2_000 },
    ];
    assert.deepEqual(resolvePointInTimeRegimeLabel(3_000, duplicate), { resolved: false, reason: "INVALID_ASSIGNMENT_SET" });
  });
});

describe("isPointInTimeRegimeLabelConsistent", () => {
  it("accepts claims matching independently resolved labels", () => {
    assert.equal(isPointInTimeRegimeLabelConsistent([{ predictionTime: 2_000, assignmentId: "a1" }, { predictionTime: 4_500, assignmentId: "a2" }], assignments()), true);
  });
  it("rejects a hindsight-reclassified claim", () => {
    assert.equal(isPointInTimeRegimeLabelConsistent([{ predictionTime: 4_500, assignmentId: "a3" }], assignments()), false);
  });
  it("rejects an empty claim set", () => {
    assert.equal(isPointInTimeRegimeLabelConsistent([], assignments()), false);
  });
});
