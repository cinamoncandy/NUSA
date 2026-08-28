import { describe, expect, it } from "vitest";
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
    expect(decision.classification).toBe("MEASURED");
    expect(decision.target).toBe("CI_CRITICAL_PATH");
    expect(decision.dominantMetric).toBe("ciP95Normalized");
    expect(decision.dominantValue).toBe(0.72);
  });

  it("fails closed when any evidence is unknown", () => {
    const decision = selectEngineeringSystemOptimization({ ...measured, conflictRate: "UNKNOWN" });
    expect(decision).toMatchObject({
      classification: "INSUFFICIENT",
      target: "INSUFFICIENT_EVIDENCE",
      dominantMetric: null,
      dominantValue: null,
    });
    expect(decision.reasons).toContain("UNKNOWN_CONFLICTRATE");
  });

  it("fails closed when the observation window is too small", () => {
    const decision = selectEngineeringSystemOptimization({ ...measured, observationCount: 3 });
    expect(decision.classification).toBe("INSUFFICIENT");
    expect(decision.reasons).toContain("INSUFFICIENT_OBSERVATION_COUNT");
  });

  it("uses deterministic metric-name ordering for exact ties", () => {
    const decision = selectEngineeringSystemOptimization({
      ...measured,
      ciP95Normalized: 0.2,
      blockedTimeRatio: 0.8,
      conflictRate: 0.8,
    });
    expect(decision.dominantMetric).toBe("blockedTimeRatio");
    expect(decision.target).toBe("BLOCKED_TIME_REDUCTION");
  });

  it("rejects invalid normalized evidence instead of coercing it", () => {
    expect(() => selectEngineeringSystemOptimization({ ...measured, idleRatio: 1.01 })).toThrow(
      "ENGINEERING_SELF_OPTIMIZER_INVALID_IDLERATIO",
    );
    expect(() => selectEngineeringSystemOptimization({ ...measured, observationCount: -1 })).toThrow(
      "ENGINEERING_SELF_OPTIMIZER_INVALID_OBSERVATIONCOUNT",
    );
  });
});
