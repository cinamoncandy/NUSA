import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateOutcome } from "./outcomeEvaluator";
import { assessOutcome } from "./outcomeFeedback";

const evidence = (overrides = {}) => ({
  key: "ci:p95",
  metric: "ci-p95-ms",
  direction: "MINIMIZE" as const,
  confidence: "VERIFIED" as const,
  baseline: 100,
  observed: 80,
  neutralTolerance: 2,
  source: "github-actions",
  ...overrides,
});

describe("outcomeFeedback", () => {
  it("classifies verified improvement using metric direction", () => {
    const result = assessOutcome(evidence());
    assert.equal(result.classification, "VERIFIED_IMPROVEMENT");
    assert.equal(result.delta, -20);
    assert.equal(result.recommendation, "KEEP");
    assert.equal(result.mutationAllowed, false);
  });

  it("classifies verified regression and recommends rework or rollback", () => {
    const result = assessOutcome(evidence({ observed: 120 }));
    assert.equal(result.classification, "REGRESSION");
    assert.equal(result.recommendation, "REWORK_OR_ROLLBACK");
  });

  it("treats bounded verified movement as neutral", () => {
    const result = assessOutcome(evidence({ observed: 101 }));
    assert.equal(result.classification, "NEUTRAL");
    assert.equal(result.recommendation, "KEEP");
  });

  it("supports maximize metrics without reversing improvement semantics", () => {
    const result = assessOutcome(evidence({ metric: "verified-value", direction: "MAXIMIZE", observed: 125 }));
    assert.equal(result.classification, "VERIFIED_IMPROVEMENT");
  });

  it("does not promote UNKNOWN evidence into a verified outcome", () => {
    const result = assessOutcome(evidence({ confidence: "UNKNOWN" }));
    assert.equal(result.classification, "INSUFFICIENT");
    assert.equal(result.recommendation, "GATHER_MORE_EVIDENCE");
  });

  it("delegates classification to the canonical outcome evaluator", () => {
    const legacyResult = assessOutcome(evidence());
    const canonicalResult = evaluateOutcome({
      key: "ci:p95",
      source: "github-actions",
      confidence: "VERIFIED",
      baseline: 100,
      current: 80,
      direction: "LOWER_IS_BETTER",
      minimumMeaningfulDelta: 2,
    });

    assert.equal(legacyResult.classification, canonicalResult.classification);
    assert.equal(legacyResult.recommendation, "KEEP");
    assert.equal(legacyResult.mutationAllowed, false);
  });
  it("fails closed on missing or invalid measurements", () => {
    assert.equal(assessOutcome(evidence({ baseline: null })).classification, "INSUFFICIENT");
    assert.equal(assessOutcome(evidence({ observed: Number.NaN })).classification, "INSUFFICIENT");
    assert.equal(assessOutcome(evidence({ neutralTolerance: -1 })).classification, "INSUFFICIENT");
  });
});
