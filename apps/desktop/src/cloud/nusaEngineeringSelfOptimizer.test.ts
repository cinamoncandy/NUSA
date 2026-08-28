import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectEngineeringSystemOptimization } from "./nusaEngineeringSelfOptimizer";

const measured = {
  observationCount: 12,
  ciP95Normalized: 0.72,
  conflictRate: 0.15,
  reworkRate: 0.2,
  idleRatio: 0.31,
  blockedTimeRatio: 0.44,
} as const;

describe("selectEngineeringSystemOptimization", () => {
  it("selects the largest measured bottleneck", () => {
    const decision = selectEngineeringSystemOptimization(measured);
    assert.equal(decision.classification, "MEASURED");
    assert.equal(decision.target, "CI_CRITICAL_PATH");
    assert.equal(decision.dominantMetric, "ciP95Normalized");
    assert.equal(decision.dominantValue, 0.72);
  });

  it("fails closed when any evidence is unknown", () => {
    const decision = selectEngineeringSystemOptimization({ ...measured, conflictRate: "UNKNOWN" });
    assert.equal(decision.classification, "INSUFFICIENT");
    assert.equal(decision.target, "INSUFFICIENT_EVIDENCE");
    assert.equal(decision.dominantMetric, null);
    assert.equal(decision.dominantValue, null);
    assert.ok(decision.reasons.includes("UNKNOWN_CONFLICTRATE"));
  });

  it("fails closed when the observation window is too small", () => {
    const decision = selectEngineeringSystemOptimization({ ...measured, observationCount: 3 });
    assert.equal(decision.classification, "INSUFFICIENT");
    assert.ok(decision.reasons.includes("INSUFFICIENT_OBSERVATION_COUNT"));
  });

  it("uses deterministic metric-name ordering for exact ties", () => {
    const decision = selectEngineeringSystemOptimization({
      ...measured,
      ciP95Normalized: 0.2,
      blockedTimeRatio: 0.8,
      conflictRate: 0.8,
    });
    assert.equal(decision.dominantMetric, "blockedTimeRatio");
    assert.equal(decision.target, "BLOCKED_TIME_REDUCTION");
  });

  it("rejects invalid normalized evidence instead of coercing it", () => {
    assert.throws(
      () => selectEngineeringSystemOptimization({ ...measured, idleRatio: 1.01 }),
      /ENGINEERING_SELF_OPTIMIZER_INVALID_IDLERATIO/,
    );
    assert.throws(
      () => selectEngineeringSystemOptimization({ ...measured, observationCount: -1 }),
      /ENGINEERING_SELF_OPTIMIZER_INVALID_OBSERVATIONCOUNT/,
    );
  });
});
