"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { projectExecutionCostStress } = require("../scripts/lib/research-cost-stress-projection.js");

const scenario = {
  scenario: {
    id: "BASE",
    feeRate: 0.0005,
    spreadBps: 5,
    slippageBps: 5
  },
  selectionMode: "FIX_BASELINE_SELECTION",
  markedTotalReturn: 0.08,
  markedMaximumDrawdown: 0.05,
  closedTradeNetProfit: 800,
  closedTradeExpectancy: 40,
  closedTradeProfitFactor: 1.4,
  totalTradingCost: 120,
  benchmarkOutperformance: 0.03,
  walkForwardResult: { combinedOutOfSampleMetrics: { totalOosClosedTrades: 4 } },
  warnings: []
};

function stress(overrides = {}) {
  return {
    selectionMode: "FIX_BASELINE_SELECTION",
    identity: {
      id: "stress-id",
      sourceExperimentSha: "real-run:dataset",
      datasetSha256: "a".repeat(64),
      stressGridSha256: "b".repeat(64),
      selectionMode: "FIX_BASELINE_SELECTION",
      engineVersion: "execution-cost-stress-v1"
    },
    baseline: scenario,
    scenarios: [scenario],
    degradation: [],
    breakEvenEstimate: { status: "NOT_FOUND", label: "BREAK_EVEN_NOT_FOUND" },
    robustnessScore: 84,
    warnings: [],
    ...overrides
  };
}

test("projects compact cost-stress evidence without leaking the full walk-forward result", () => {
  const projected = projectExecutionCostStress(stress());
  assert.equal(projected.identity.id, "stress-id");
  assert.match(projected.identity.resultSha256, /^[0-9a-f]{64}$/);
  assert.equal(projected.baseline.totalTradingCost, 120);
  assert.equal(projected.scenarios.length, 1);
  assert.equal(projected.baseline.totalOosClosedTrades, 4);
  assert.equal("walkForwardResult" in projected.baseline, false);
  assert.deepEqual(projected.breakEvenEstimate, { status: "NOT_FOUND", label: "BREAK_EVEN_NOT_FOUND" });
});

test("rejects incomplete cost-stress evidence instead of emitting a partial report", () => {
  assert.throws(() => projectExecutionCostStress(stress({ baseline: undefined })), /scenario evidence is malformed/);
  assert.throws(() => projectExecutionCostStress(stress({ warnings: undefined })), /evidence is incomplete/);
});


test("cost-stress result digest changes when scenario outcomes change", () => {
  const first = projectExecutionCostStress(stress());
  const changedScenario = { ...scenario, markedTotalReturn: scenario.markedTotalReturn + 0.01 };
  const second = projectExecutionCostStress(stress({ baseline: changedScenario, scenarios: [changedScenario] }));
  assert.notEqual(first.identity.resultSha256, second.identity.resultSha256);
});

test("the projected result digest is the one the robustness verifier recomputes for real runner scenarios", () => {
  const { canonicalCostStressResultSha256 } = require("../dist/apps/desktop/src/cloud/researchRunRobustnessEvidence.js");
  // The real runner labels each scenario and emits them in grid order, not id order; the verifier
  // drops the label and orders by id. Hashing the raw projection failed every research run with
  // COST_STRESS_RESULT_HASH_MISMATCH.
  const labelled = (id, fee, warnings) => ({ ...scenario, scenario: { id, label: `${id} label`, feeRate: fee, spreadBps: 5, slippageBps: 5 }, warnings });
  const scenarios = [labelled("SEVERE", 0.002, ["b", "a", "a"]), labelled("BASE", 0.0005, []), labelled("MODERATE", 0.001, [])];
  const projected = projectExecutionCostStress(stress({ baseline: scenarios[1], scenarios }));
  assert.equal(
    projected.identity.resultSha256,
    canonicalCostStressResultSha256([...projected.scenarios].reverse(), "FIX_BASELINE_SELECTION"),
    "digest must not depend on scenario order or display-only fields",
  );
  const withoutLabels = projected.scenarios.map((entry) => ({ ...entry, scenario: { ...entry.scenario, label: undefined } }));
  assert.equal(projected.identity.resultSha256, canonicalCostStressResultSha256(withoutLabels, "FIX_BASELINE_SELECTION"));
});
