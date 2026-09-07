import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateOutcome } from "./outcomeEvaluator";

const verified = (overrides: Partial<Parameters<typeof evaluateOutcome>[0]> = {}) => ({
  key: "ci:p95",
  source: "github-evidence",
  confidence: "VERIFIED" as const,
  baseline: 120,
  current: 90,
  direction: "LOWER_IS_BETTER" as const,
  minimumMeaningfulDelta: 5,
  ...overrides,
});

describe("outcomeEvaluator", () => {
  it("classifies a verified directional improvement", () => {
    const result = evaluateOutcome(verified());
    assert.equal(result.classification, "VERIFIED_IMPROVEMENT");
    assert.equal(result.directionalDelta, 30);
    assert.equal(result.recommendation, "KEEP");
    assert.equal(result.mutationAllowed, false);
  });

  it("classifies a verified regression and requires rework or rollback", () => {
    const result = evaluateOutcome(verified({ current: 140 }));
    assert.equal(result.classification, "REGRESSION");
    assert.equal(result.directionalDelta, -20);
    assert.equal(result.recommendation, "REWORK_OR_ROLLBACK");
    assert.equal(result.mutationAllowed, false);
  });

  it("keeps threshold-bounded movement neutral", () => {
    const result = evaluateOutcome(verified({ current: 116 }));
    assert.equal(result.classification, "NEUTRAL");
    assert.equal(result.directionalDelta, 4);
    assert.equal(result.recommendation, "KEEP");
  });

  it("does not promote unknown evidence into an outcome claim", () => {
    const result = evaluateOutcome(verified({ confidence: "UNKNOWN" }));
    assert.equal(result.classification, "INSUFFICIENT");
    assert.equal(result.directionalDelta, null);
    assert.equal(result.recommendation, "GATHER_EVIDENCE");
  });

  it("fails closed on absent or invalid measurement evidence", () => {
    const absent = evaluateOutcome(verified({ baseline: null }));
    const invalidThreshold = evaluateOutcome(verified({ minimumMeaningfulDelta: -1 }));
    assert.equal(absent.classification, "INSUFFICIENT");
    assert.equal(invalidThreshold.classification, "INSUFFICIENT");
  });

  it("supports metrics where higher values are better", () => {
    const result = evaluateOutcome(
      verified({ baseline: 8, current: 12, direction: "HIGHER_IS_BETTER", minimumMeaningfulDelta: 1 }),
    );
    assert.equal(result.classification, "VERIFIED_IMPROVEMENT");
    assert.equal(result.directionalDelta, 4);
  });
  it("fails closed instead of treating an unknown direction as lower-is-better", () => {
    const result = evaluateOutcome(verified({ direction: "UNKNOWN" as never }));
    assert.equal(result.classification, "INSUFFICIENT");
    assert.equal(result.directionalDelta, null);
    assert.equal(result.recommendation, "GATHER_EVIDENCE");
  });

  it("rejects malformed evidence identity before producing an outcome", () => {
    assert.throws(
      () => evaluateOutcome(verified({ key: "" })),
      /OUTCOME_EVIDENCE_IDENTITY_INVALID/,
    );
    assert.throws(
      () => evaluateOutcome(verified({ source: "   " })),
      /OUTCOME_EVIDENCE_IDENTITY_INVALID/,
    );
  });

  it("fails closed on an unknown confidence value", () => {
    const result = evaluateOutcome(verified({ confidence: "MAYBE" as never }));
    assert.equal(result.classification, "INSUFFICIENT");
    assert.equal(result.directionalDelta, null);
    assert.equal(result.recommendation, "GATHER_EVIDENCE");
  });

});
