import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateAiPredictionTemporalIdentity,
  assignAiEvaluationPartition,
  isHoldoutUntouchedByTraining,
  evaluatePurgeEmbargo,
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

describe("evaluatePurgeEmbargo", () => {
  const policy = { embargoMs: 100 };

  it("keeps a TRAIN candidate whose outcome window does not overlap or approach a boundary", () => {
    const result = evaluatePurgeEmbargo({ predictionTime: 100, outcomeWindowStart: 100, outcomeWindowEnd: 300 }, partitions(), policy);
    assert.deepEqual(result, { excluded: false });
  });

  it("purges a TRAIN candidate whose outcome window overlaps the VALIDATION partition", () => {
    const result = evaluatePurgeEmbargo({ predictionTime: 800, outcomeWindowStart: 800, outcomeWindowEnd: 1_200 }, partitions(), policy);
    assert.equal(result.excluded, true);
    if (result.excluded) {
      assert.equal(result.reason, "PURGED_OVERLAPPING_OUTCOME_WINDOW");
      assert.equal(result.conflictingPartitionId, "validation");
    }
  });

  it("purges a TRAIN candidate whose outcome window overlaps the HOLDOUT partition even without touching VALIDATION", () => {
    const result = evaluatePurgeEmbargo({ predictionTime: 100, outcomeWindowStart: 2_500, outcomeWindowEnd: 2_600 }, partitions(), policy);
    assert.equal(result.excluded, true);
    if (result.excluded) assert.equal(result.conflictingPartitionId, "holdout");
  });

  it("embargoes a TRAIN candidate predicted just before a boundary even with no literal overlap", () => {
    const result = evaluatePurgeEmbargo({ predictionTime: 950, outcomeWindowStart: 950, outcomeWindowEnd: 960 }, partitions(), policy);
    assert.equal(result.excluded, true);
    if (result.excluded) {
      assert.equal(result.reason, "EMBARGOED_NEAR_BOUNDARY");
      assert.equal(result.conflictingPartitionId, "validation");
    }
  });

  it("does not embargo a candidate outside the embargo window", () => {
    const result = evaluatePurgeEmbargo({ predictionTime: 800, outcomeWindowStart: 800, outcomeWindowEnd: 850 }, partitions(), policy);
    assert.deepEqual(result, { excluded: false });
  });

  it("never excludes a candidate against TRAIN-role partitions", () => {
    const trainOnly: readonly AiEvaluationPartition[] = [{ partitionId: "train", role: "TRAIN", startTime: 0, endTime: 1_000 }];
    const result = evaluatePurgeEmbargo({ predictionTime: 500, outcomeWindowStart: 500, outcomeWindowEnd: 999 }, trainOnly, policy);
    assert.deepEqual(result, { excluded: false });
  });

  it("fails closed toward exclusion on an inverted outcome window", () => {
    const result = evaluatePurgeEmbargo({ predictionTime: 100, outcomeWindowStart: 500, outcomeWindowEnd: 100 }, partitions(), policy);
    assert.equal(result.excluded, true);
  });

  it("fails closed toward exclusion on a negative embargoMs policy", () => {
    const result = evaluatePurgeEmbargo({ predictionTime: 100, outcomeWindowStart: 100, outcomeWindowEnd: 200 }, partitions(), { embargoMs: -1 });
    assert.equal(result.excluded, true);
  });

  it("fails closed when a boundary partition has a malformed timestamp", () => {
    const malformed: readonly AiEvaluationPartition[] = [
      { partitionId: "validation", role: "VALIDATION", startTime: Number.NaN, endTime: 2_000 },
    ];
    const result = evaluatePurgeEmbargo({ predictionTime: 100, outcomeWindowStart: 100, outcomeWindowEnd: 200 }, malformed, policy);
    assert.equal(result.excluded, true);
  });

  it("fails closed when boundary partitions overlap", () => {
    const overlapping: readonly AiEvaluationPartition[] = [
      { partitionId: "validation", role: "VALIDATION", startTime: 1_000, endTime: 2_000 },
      { partitionId: "holdout", role: "HOLDOUT", startTime: 1_500, endTime: 2_500 },
    ];
    const result = evaluatePurgeEmbargo({ predictionTime: 100, outcomeWindowStart: 100, outcomeWindowEnd: 200 }, overlapping, policy);
    assert.equal(result.excluded, true);
  });
});
