import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adviseConcurrency } from "./concurrencyAdvisor";

const verified = () => ({
  source: "github-evidence",
  confidence: "VERIFIED" as const,
  currentWip: 2,
  maxWip: 4,
  throughputTrend: 0.2,
  conflictRate: 0.02,
  reworkRate: 0.02,
  ciUtilization: 0.5,
});

describe("concurrencyAdvisor", () => {
  it("increases by at most one when verified headroom exists", () => {
    const result = adviseConcurrency(verified());
    assert.equal(result.action, "INCREASE_BY_ONE");
    assert.equal(result.recommendedWip, 3);
    assert.equal(result.mutationAllowed, false);
  });

  it("decreases by one under verified contention pressure", () => {
    const result = adviseConcurrency({ ...verified(), conflictRate: 0.2 });
    assert.equal(result.action, "DECREASE_BY_ONE");
    assert.equal(result.recommendedWip, 1);
    assert.equal(result.mutationAllowed, false);
  });

  it("does not decrease below one", () => {
    const result = adviseConcurrency({ ...verified(), currentWip: 1, ciUtilization: 0.95 });
    assert.equal(result.action, "HOLD");
    assert.equal(result.recommendedWip, 1);
  });

  it("fails closed for UNKNOWN evidence", () => {
    const result = adviseConcurrency({ ...verified(), confidence: "UNKNOWN" });
    assert.equal(result.action, "HOLD");
    assert.equal(result.recommendedWip, 2);
  });

  it("fails closed for invalid measurements", () => {
    const result = adviseConcurrency({ ...verified(), ciUtilization: 1.2 });
    assert.equal(result.action, "HOLD");
    assert.equal(result.recommendedWip, 2);
  });

  it("holds when throughput does not justify expansion", () => {
    const result = adviseConcurrency({ ...verified(), throughputTrend: 0 });
    assert.equal(result.action, "HOLD");
    assert.equal(result.recommendedWip, 2);
  });

  it("never recommends above the explicit max WIP", () => {
    const result = adviseConcurrency({ ...verified(), currentWip: 4, maxWip: 4 });
    assert.equal(result.action, "HOLD");
    assert.equal(result.recommendedWip, 4);
  });
});
