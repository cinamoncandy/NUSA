import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateShadowAllocation, ShadowAllocationEvaluationError, type ShadowAllocationPeriodInput } from "./shadowAllocationEvaluation";
import type { LeagueCapitalAllocationAdvisory } from "./leagueCapitalAllocation";

function advisory(weights: Readonly<Record<string, number>>): LeagueCapitalAllocationAdvisory {
  const ids = Object.keys(weights);
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-26T05:00:00.000Z",
    policy: { maximumCandidateWeight: 0.6, minimumEvidenceBreadth: 0.5, maximumCandidateCount: 5, maximumFamilyWeight: 0.6 },
    entries: ids.map((id, index) => ({
      id,
      familyId: "family-1",
      rank: index + 1,
      leagueScore: 100 - index,
      evidenceBreadth: 1,
      researchWeight: weights[id]!,
      reasons: ["NO_EXECUTION_AUTHORITY", "NORMALIZED_RESEARCH_WEIGHTS_ONLY"],
      sourceDatasetIds: [`dataset-${id}`],
    })),
    excludedCandidateIds: [],
    reasons: ["NO_EXECUTION_AUTHORITY"],
    provenance: { sourceDatasetIds: ids.map((id) => `dataset-${id}`).sort() },
  };
}

function period(
  periodIndex: number,
  weights: Readonly<Record<string, number>>,
  realizedReturns: Readonly<Record<string, number>>,
  overrides: Partial<ShadowAllocationPeriodInput> = {},
): ShadowAllocationPeriodInput {
  return {
    periodIndex,
    advisory: advisory(weights),
    realizedReturns,
    benchmarkReturn: 0,
    turnoverCostRate: 0,
    ...overrides,
  };
}

describe("evaluateShadowAllocation", () => {
  it("applies each period's own weights to that period's realized returns", () => {
    const result = evaluateShadowAllocation([
      period(0, { a: 0.5, b: 0.5 }, { a: 0.10, b: 0.00 }),
      period(1, { a: 0.5, b: 0.5 }, { a: 0.00, b: 0.20 }),
    ]);
    assert.equal(result.periods[0]!.grossReturn, 0.05);
    assert.equal(result.periods[1]!.grossReturn, 0.10);
    // Compounded, not summed: 1.05 * 1.10 - 1
    assert.ok(Math.abs(result.cumulativeNetReturn - 0.155) < 1e-12);
    assert.equal(result.evidenceMode, "PAPER_SHADOW");
  });

  it("always subtracts real costs and reports the drag rather than a cost-free result", () => {
    const costed = evaluateShadowAllocation([
      period(0, { a: 1 }, { a: 0.10 }, { turnoverCostRate: 0.01 }),
      period(1, { b: 1 }, { b: 0.10 }, { turnoverCostRate: 0.01 }),
    ]);
    // Period 1 fully rotates a -> b: turnover 1, cost 0.01.
    assert.equal(costed.periods[1]!.turnover, 1);
    assert.equal(costed.periods[1]!.cost, 0.01);
    assert.ok(costed.periods[1]!.netReturn < costed.periods[1]!.grossReturn);
    assert.ok(costed.cumulativeNetReturn < costed.cumulativeGrossReturn, "net must never exceed gross once costs exist");
    assert.ok(costed.totalCost > 0);
    assert.ok(costed.costDrag > 0);
  });

  it("fails closed when a weighted candidate has no realized return, instead of assuming zero", () => {
    // Silently treating the missing return as 0 would report +0.05 instead of failing.
    assert.throws(
      () => evaluateShadowAllocation([period(0, { a: 0.5, b: 0.5 }, { a: 0.10 })]),
      (error) => error instanceof ShadowAllocationEvaluationError && error.code === "MISSING_REALIZED_RETURN",
    );
  });

  it("rejects out-of-order or duplicated periods so later weights cannot be applied to earlier returns", () => {
    for (const sequence of [
      [period(1, { a: 1 }, { a: 0.01 }), period(0, { a: 1 }, { a: 0.01 })],
      [period(0, { a: 1 }, { a: 0.01 }), period(0, { a: 1 }, { a: 0.01 })],
    ]) {
      assert.throws(
        () => evaluateShadowAllocation(sequence),
        (error) => error instanceof ShadowAllocationEvaluationError && error.code === "NON_MONOTONIC_PERIODS",
      );
    }
  });

  it("fails closed on malformed weights instead of silently renormalizing them", () => {
    assert.throws(
      () => evaluateShadowAllocation([period(0, { a: 0.5, b: 0.2 }, { a: 0.1, b: 0.1 })]),
      (error) => error instanceof ShadowAllocationEvaluationError && error.code === "WEIGHTS_NOT_NORMALIZED",
    );
    assert.throws(
      () => evaluateShadowAllocation([period(0, { a: 1.5, b: -0.5 }, { a: 0.1, b: 0.1 })]),
      (error) => error instanceof ShadowAllocationEvaluationError && error.code === "INVALID_WEIGHT",
    );
    assert.throws(
      () => evaluateShadowAllocation([period(0, { a: 1 }, { a: Number.NaN })]),
      (error) => error instanceof ShadowAllocationEvaluationError && error.code === "NON_FINITE_REALIZED_RETURN",
    );
    assert.throws(
      () => evaluateShadowAllocation([period(0, { a: 1 }, { a: 0.1 }, { turnoverCostRate: -0.01 })]),
      (error) => error instanceof ShadowAllocationEvaluationError && error.code === "NEGATIVE_COST_RATE",
    );
  });

  it("measures drawdown from the realized net equity path, not from returns in isolation", () => {
    const result = evaluateShadowAllocation([
      period(0, { a: 1 }, { a: 0.50 }),
      period(1, { a: 1 }, { a: -0.40 }),
      period(2, { a: 1 }, { a: 0.10 }),
    ]);
    // Peak 1.5, trough 0.9 -> drawdown 0.4
    assert.ok(Math.abs(result.maximumDrawdown - 0.4) < 1e-12);
  });

  it("surfaces concentration and allocation instability so an unfollowable advisory is visible", () => {
    const concentrated = evaluateShadowAllocation([period(0, { a: 1 }, { a: 0.01 })]);
    assert.equal(concentrated.averageConcentration, 1, "a single-candidate portfolio is maximally concentrated");

    const diversified = evaluateShadowAllocation([period(0, { a: 0.25, b: 0.25, c: 0.25, d: 0.25 }, { a: 0.01, b: 0.01, c: 0.01, d: 0.01 })]);
    assert.ok(Math.abs(diversified.averageConcentration - 0.25) < 1e-12);

    const churning = evaluateShadowAllocation([
      period(0, { a: 1 }, { a: 0.01 }),
      period(1, { b: 1 }, { b: 0.01 }),
      period(2, { c: 1 }, { c: 0.01 }),
    ]);
    assert.equal(churning.candidateChurnRatio, 1, "a fully rotating advisory must report full churn");
    assert.ok(churning.allocationInstability > 0.5);

    const stable = evaluateShadowAllocation([
      period(0, { a: 1 }, { a: 0.01 }),
      period(1, { a: 1 }, { a: 0.01 }),
      period(2, { a: 1 }, { a: 0.01 }),
    ]);
    assert.equal(stable.candidateChurnRatio, 0);
    assert.ok(stable.allocationInstability < churning.allocationInstability);
  });

  it("reports benchmark excess against the realized benchmark, net of costs", () => {
    const result = evaluateShadowAllocation([
      period(0, { a: 1 }, { a: 0.05 }, { benchmarkReturn: 0.08 }),
    ]);
    // Underperforming the benchmark must be reported as negative excess, not hidden.
    assert.ok(Math.abs(result.cumulativeBenchmarkExcess - -0.03) < 1e-12);
    assert.ok(result.periods[0]!.benchmarkExcess < 0);
  });

  it("labels a short evaluation window as narrow evidence rather than implying a conclusion", () => {
    const short = evaluateShadowAllocation([period(0, { a: 1 }, { a: 0.20 })]);
    assert.ok(short.reasons.includes("NARROW_SHADOW_EVIDENCE_WINDOW"));
    assert.ok(short.reasons.includes("PAPER_SHADOW_EVIDENCE_ONLY"));
    assert.equal(short.evidenceMode, "PAPER_SHADOW");
  });

  it("preserves provenance from every contributing advisory", () => {
    const result = evaluateShadowAllocation([
      period(0, { a: 1 }, { a: 0.01 }),
      period(1, { b: 1 }, { b: 0.01 }),
    ]);
    assert.deepEqual(result.sourceDatasetIds, ["dataset-a", "dataset-b"]);
  });

  it("never emits an order, broker call, capital amount, or LIVE authority", () => {
    const result = evaluateShadowAllocation([period(0, { a: 1 }, { a: 0.01 })]);
    const serialized = JSON.stringify(result).toLowerCase();
    for (const forbidden of ["liveauthority", "productionmutationallowed", "broker", "withdraw", "transfer", "notional", "capitalamount", "activationlease"]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
    assert.ok(result.reasons.includes("NO_EXECUTION_AUTHORITY"));
    // PAPER results must never be expressed as a LIVE expectation.
    assert.equal(serialized.includes("live"), false);
  });
});
