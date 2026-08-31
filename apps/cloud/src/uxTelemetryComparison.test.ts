import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareUxMetrics } from "./uxTelemetryComparison";
import type { UxMetricsSummary } from "./uxTelemetryMetrics";

function summary(overrides: Partial<UxMetricsSummary>): UxMetricsSummary {
  return {
    schemaVersion: 1,
    sampleTaskCount: 50,
    sampleSessionCount: 20,
    taskCompletionTimeMsMedian: 1_000,
    taskCompletionTapsMedian: 5,
    navigationDepthMax: 3,
    navigationDepthMean: 2,
    errorRate: 0.1,
    recoveryRate: 0.9,
    approvalFrictionRate: 0.1,
    abandonmentRate: 0.1,
    repeatActionRate: 0.05,
    ...overrides,
  };
}

describe("ux telemetry before/after comparison", () => {
  it("classifies a clear reduction in task completion time as VERIFIED_IMPROVEMENT overall", () => {
    const result = compareUxMetrics(summary({}), summary({ taskCompletionTimeMsMedian: 500 }));
    assert.equal(result.overall, "VERIFIED_IMPROVEMENT");
    const metric = result.comparisons.find((entry) => entry.metric === "taskCompletionTimeMsMedian");
    assert.equal(metric?.outcome, "VERIFIED_IMPROVEMENT");
  });

  it("classifies a worsened metric as REGRESSION overall even if others improved", () => {
    const after = summary({ taskCompletionTimeMsMedian: 500, errorRate: 0.3 });
    const result = compareUxMetrics(summary({}), after);
    assert.equal(result.overall, "REGRESSION");
  });

  it("treats a small change within the neutral band as NEUTRAL", () => {
    const result = compareUxMetrics(summary({}), summary({ taskCompletionTimeMsMedian: 1_010 }));
    const metric = result.comparisons.find((entry) => entry.metric === "taskCompletionTimeMsMedian");
    assert.equal(metric?.outcome, "NEUTRAL");
  });

  it("is INSUFFICIENT when the sample size is below the minimum", () => {
    const result = compareUxMetrics(
      summary({ sampleTaskCount: 5 }),
      summary({ sampleTaskCount: 5, taskCompletionTimeMsMedian: 500 }),
      20,
    );
    assert.equal(result.overall, "INSUFFICIENT");
    for (const comparison of result.comparisons) assert.equal(comparison.outcome, "INSUFFICIENT");
  });

  it("is INSUFFICIENT for a metric that has no data in either window even with enough samples", () => {
    const result = compareUxMetrics(
      summary({ navigationDepthMax: null }),
      summary({ navigationDepthMax: null }),
    );
    const metric = result.comparisons.find((entry) => entry.metric === "navigationDepthMax");
    assert.equal(metric?.outcome, "INSUFFICIENT");
  });

  it("is NEUTRAL overall when nothing meaningfully changed", () => {
    const result = compareUxMetrics(summary({}), summary({}));
    assert.equal(result.overall, "NEUTRAL");
  });

  it("never claims VERIFIED_IMPROVEMENT for a zero-to-zero metric", () => {
    const result = compareUxMetrics(summary({ errorRate: 0 }), summary({ errorRate: 0 }));
    const metric = result.comparisons.find((entry) => entry.metric === "errorRate");
    assert.equal(metric?.outcome, "NEUTRAL");
  });

  it("treats a zero-to-nonzero shift on a zero baseline as REGRESSION", () => {
    const result = compareUxMetrics(summary({ errorRate: 0 }), summary({ errorRate: 0.2 }));
    const metric = result.comparisons.find((entry) => entry.metric === "errorRate");
    assert.equal(metric?.outcome, "REGRESSION");
  });
});
