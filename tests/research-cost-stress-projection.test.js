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
  assert.equal(projected.baseline.totalTradingCost, 120);
  assert.equal(projected.scenarios.length, 1);
  assert.equal("walkForwardResult" in projected.baseline, false);
  assert.deepEqual(projected.breakEvenEstimate, { status: "NOT_FOUND", label: "BREAK_EVEN_NOT_FOUND" });
});

test("rejects incomplete cost-stress evidence instead of emitting a partial report", () => {
  assert.throws(() => projectExecutionCostStress(stress({ baseline: undefined })), /scenario evidence is malformed/);
  assert.throws(() => projectExecutionCostStress(stress({ warnings: undefined })), /evidence is incomplete/);
});
