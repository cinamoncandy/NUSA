import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessNusaEngineeringOutcome } from "./nusaEngineeringOutcomeFeedback";

describe("assessNusaEngineeringOutcome", () => {
  it("classifies lower latency as verified improvement when evidence clears threshold", () => {
    const result = assessNusaEngineeringOutcome({
      metricId: "ci-p95-ms",
      direction: "LOWER_IS_BETTER",
      baseline: 1000,
      postMerge: 800,
      minimumMeaningfulChange: 100,
    });
    assert.equal(result.classification, "VERIFIED_IMPROVEMENT");
    assert.equal(result.recommendation, "KEEP");
    assert.equal(result.delta, -200);
  });

  it("classifies measurable regression and requires rollback or rework", () => {
    const result = assessNusaEngineeringOutcome({
      metricId: "verified-value-per-hour",
      direction: "HIGHER_IS_BETTER",
      baseline: 4,
      postMerge: 2,
      minimumMeaningfulChange: 1,
    });
    assert.equal(result.classification, "REGRESSION");
    assert.equal(result.recommendation, "ROLLBACK_OR_REWORK");
  });

  it("keeps UNKNOWN evidence insufficient instead of inventing confidence", () => {
    const result = assessNusaEngineeringOutcome({
      metricId: "conflict-rate",
      direction: "LOWER_IS_BETTER",
      baseline: null,
      postMerge: 0.1,
      minimumMeaningfulChange: 0.01,
    });
    assert.equal(result.classification, "INSUFFICIENT");
    assert.equal(result.delta, null);
  });

  it("classifies sub-threshold movement as neutral", () => {
    const result = assessNusaEngineeringOutcome({
      metricId: "queue-age-ms",
      direction: "LOWER_IS_BETTER",
      baseline: 1000,
      postMerge: 950,
      minimumMeaningfulChange: 100,
    });
    assert.equal(result.classification, "NEUTRAL");
    assert.equal(result.recommendation, "OBSERVE");
  });
});
