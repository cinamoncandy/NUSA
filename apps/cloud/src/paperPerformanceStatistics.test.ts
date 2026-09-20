import assert from "node:assert/strict";
import test from "node:test";
import { assertPaperPerformanceCadence, assertUniformPaperPerformanceObservations, availablePaperPerformanceStatistic, unavailablePaperPerformanceStatistic } from "./paperPerformanceStatistics";

test("insufficient statistics are explicit instead of NaN or invented values", () => {
  assert.deepEqual(unavailablePaperPerformanceStatistic("INSUFFICIENT_OBSERVATIONS"), {
    status: "INSUFFICIENT",
    reason: "INSUFFICIENT_OBSERVATIONS",
  });
  assert.deepEqual(unavailablePaperPerformanceStatistic("CADENCE_UNSPECIFIED"), {
    status: "INSUFFICIENT",
    reason: "CADENCE_UNSPECIFIED",
  });
  assert.deepEqual(unavailablePaperPerformanceStatistic("ZERO_VARIANCE"), {
    status: "INSUFFICIENT",
    reason: "ZERO_VARIANCE",
  });
});

test("available statistics reject NaN and Infinity", () => {
  assert.deepEqual(availablePaperPerformanceStatistic(1.25), { status: "AVAILABLE", value: 1.25 });
  assert.throws(() => availablePaperPerformanceStatistic(Number.NaN), /NON_FINITE/);
  assert.throws(() => availablePaperPerformanceStatistic(Number.POSITIVE_INFINITY), /NON_FINITE/);
});

test("statistics cadence and annualization conventions are explicit and uniform", () => {
  const cadence = { observationIntervalMs: 1_000, periodsPerYear: 31_536 };
  assert.doesNotThrow(() => assertPaperPerformanceCadence(cadence));
  assert.doesNotThrow(() => assertUniformPaperPerformanceObservations([1_000, 2_000, 3_000], cadence));
  assert.throws(() => assertPaperPerformanceCadence({ ...cadence, observationIntervalMs: 0 }), /CADENCE_INVALID/);
  assert.throws(() => assertPaperPerformanceCadence({ ...cadence, periodsPerYear: 0 }), /ANNUALIZATION_INVALID/);
  assert.throws(() => assertUniformPaperPerformanceObservations([1_000, 2_500, 3_000], cadence), /NON_UNIFORM_CADENCE/);
  assert.throws(() => assertUniformPaperPerformanceObservations([1_000, 2_000], cadence), /INSUFFICIENT_OBSERVATIONS/);
});
