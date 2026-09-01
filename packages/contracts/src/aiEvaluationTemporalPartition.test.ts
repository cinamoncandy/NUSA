import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateAiPredictionTemporalIdentity,
  assignAiEvaluationPartition,
  isHoldoutUntouchedByTraining,
  type AiPredictionTemporalIdentity,
  type AiEvaluationPartition,
} from "./aiEvaluationTemporalPartition";

function validIdentity(overrides: Partial<AiPredictionTemporalIdentity> = {}): AiPredictionTemporalIdentity {
  return {
    eventTime: 5_000,
    receivedTime: 900,
    modelAvailableTime: 800,
    predictionTime: 1_000,
    outcomeWindowStart: 1_000,
    outcomeWindowEnd: 6_000,
    ...overrides,
  };
}

describe("validateAiPredictionTemporalIdentity", () => {
  it("accepts a causally valid identity", () => {
    assert.deepEqual(validateAiPredictionTemporalIdentity(validIdentity()), { valid: true, errors: [] });
  });

  it("rejects a model used before it was available", () => {
    const result = validateAiPredictionTemporalIdentity(validIdentity({ modelAvailableTime: 1_500 }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("MODEL_NOT_YET_AVAILABLE_AT_PREDICTION_TIME"));
  });

  it("rejects anchor data received after the prediction was made (future leakage)", () => {
    const result = validateAiPredictionTemporalIdentity(validIdentity({ receivedTime: 1_500 }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("ANCHOR_DATA_RECEIVED_AFTER_PREDICTION_FUTURE_LEAKAGE"));
  });

  it("rejects a prediction made after its own outcome window already started", () => {
    const result = validateAiPredictionTemporalIdentity(validIdentity({ outcomeWindowStart: 500 }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("PREDICTION_MADE_AFTER_OUTCOME_WINDOW_STARTED"));
  });

  it("rejects an inverted outcome window", () => {
    const result = validateAiPredictionTemporalIdentity(validIdentity({ outcomeWindowStart: 6_000, outcomeWindowEnd: 1_000 }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("OUTCOME_WINDOW_INVERTED"));
  });

  it("rejects an event time outside its own outcome window", () => {
    const result = validateAiPredictionTemporalIdentity(validIdentity({ eventTime: 100 }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("EVENT_TIME_OUTSIDE_OUTCOME_WINDOW"));
  });

  it("rejects missing or non-integer timestamps without evaluating ordering", () => {
    const result = validateAiPredictionTemporalIdentity({ ...validIdentity(), predictionTime: Number.NaN });
    assert.equal(result.valid, false);
    assert.deepEqual([...result.errors], ["PREDICTIONTIME_INVALID"]);
  });

  it("rejects a negative timestamp", () => {
    const result = validateAiPredictionTemporalIdentity(validIdentity({ receivedTime: -1 }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("RECEIVEDTIME_INVALID"));
  });
});

function partitions(): readonly AiEvaluationPartition[] {
  return [
    { partitionId: "train", role: "TRAIN", startTime: 0, endTime: 1_000 },
    { partitionId: "validation", role: "VALIDATION", startTime: 1_000, endTime: 2_000 },
    { partitionId: "holdout", role: "HOLDOUT", startTime: 2_000, endTime: 3_000 },
  ];
}

describe("assignAiEvaluationPartition", () => {
  it("assigns a prediction time to the correct partition", () => {
    assert.deepEqual(assignAiEvaluationPartition(500, partitions()), { assigned: true, partitionId: "train", role: "TRAIN" });
    assert.deepEqual(assignAiEvaluationPartition(1_500, partitions()), { assigned: true, partitionId: "validation", role: "VALIDATION" });
    assert.deepEqual(assignAiEvaluationPartition(2_500, partitions()), { assigned: true, partitionId: "holdout", role: "HOLDOUT" });
  });

  it("treats partition boundaries as half-open ([start, end))", () => {
    assert.equal((assignAiEvaluationPartition(1_000, partitions()) as { partitionId: string }).partitionId, "validation");
    assert.equal((assignAiEvaluationPartition(999, partitions()) as { partitionId: string }).partitionId, "train");
  });

  it("fails closed when no partition covers the prediction time", () => {
    const result = assignAiEvaluationPartition(10_000, partitions());
    assert.deepEqual(result, { assigned: false, reason: "NO_MATCHING_PARTITION" });
  });

  it("fails closed on an empty partition set", () => {
    assert.deepEqual(assignAiEvaluationPartition(500, []), { assigned: false, reason: "INVALID_PARTITION_SET" });
  });

  it("fails closed on overlapping partitions", () => {
    const overlapping: readonly AiEvaluationPartition[] = [
      { partitionId: "a", role: "TRAIN", startTime: 0, endTime: 1_000 },
      { partitionId: "b", role: "VALIDATION", startTime: 500, endTime: 1_500 },
    ];
    const result = assignAiEvaluationPartition(700, overlapping);
    assert.deepEqual(result, { assigned: false, reason: "INVALID_PARTITION_SET" });
  });

  it("fails closed on a duplicate partition id", () => {
    const duplicate: readonly AiEvaluationPartition[] = [
      { partitionId: "a", role: "TRAIN", startTime: 0, endTime: 1_000 },
      { partitionId: "a", role: "VALIDATION", startTime: 1_000, endTime: 2_000 },
    ];
    assert.deepEqual(assignAiEvaluationPartition(500, duplicate), { assigned: false, reason: "INVALID_PARTITION_SET" });
  });

  it("fails closed on an inverted partition (start >= end)", () => {
    const inverted: readonly AiEvaluationPartition[] = [{ partitionId: "a", role: "TRAIN", startTime: 1_000, endTime: 500 }];
    assert.deepEqual(assignAiEvaluationPartition(700, inverted), { assigned: false, reason: "INVALID_PARTITION_SET" });
  });
});

describe("isHoldoutUntouchedByTraining", () => {
  it("is true when every prediction time falls in the HOLDOUT partition", () => {
    assert.equal(isHoldoutUntouchedByTraining([2_100, 2_500, 2_900], partitions()), true);
  });

  it("is false when any prediction time falls in TRAIN or VALIDATION", () => {
    assert.equal(isHoldoutUntouchedByTraining([2_100, 500], partitions()), false);
  });

  it("is false for an empty prediction set rather than vacuously true", () => {
    assert.equal(isHoldoutUntouchedByTraining([], partitions()), false);
  });

  it("is false when a prediction time cannot be assigned at all", () => {
    assert.equal(isHoldoutUntouchedByTraining([2_100, 50_000], partitions()), false);
  });
});
