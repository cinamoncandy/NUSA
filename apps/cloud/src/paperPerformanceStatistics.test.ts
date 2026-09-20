import assert from "node:assert/strict";
import test from "node:test";
import { availablePaperPerformanceStatistic, unavailablePaperPerformanceStatistic } from "./paperPerformanceStatistics";

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
