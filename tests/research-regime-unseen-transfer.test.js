"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { evaluateStrategyByRegime } = require("../dist/apps/desktop/src/cloud/regimeAwareStrategyEvaluation.js");

const DATASET_ID = "dataset-regime-transfer";
const DATASET_HASH = "a".repeat(64);

function windowResult(index, timestamp, totalReturn = 0.03) {
  return {
    window: {
      index,
      trainStart: 0,
      trainEnd: 0,
      testStart: 0,
      testEnd: 0,
      trainPoints: [{ timestamp: timestamp - 2, close: 100 }],
      testPoints: [{ timestamp, close: 101 }]
    },
    selectedCandidateId: "candidate-1",
    trainResult: {},
    candidateTrainScores: [],
    selectionReason: "test",
    testResult: {
      metrics: {
        totalReturn,
        maxDrawdown: 0.05,
        totalTradingCost: 1,
        initialEquity: 1000
      },
      benchmark: { outperformance: 0.01 },
      performance: { trades: 1 }
    }
  };
}

function regime(windowIndex, state, asOf) {
  return {
    windowIndex,
    regime: {
      schemaVersion: 1,
      asOf,
      state,
      score: 0.5,
      components: {
        breadth: 0.5,
        medianReturn: 0,
        medianDrawdown: -0.02,
        medianVolatility: 0.02,
        dispersion: 0.01
      },
      reasons: [],
      sourceDatasetIds: [DATASET_ID]
    }
  };
}

function experiment(windows) {
  return {
    manifest: { datasetId: DATASET_ID, contentSha256: DATASET_HASH },
    generatedAt: "2026-08-30T00:00:00.000Z",
    walkForwardResult: { windows }
  };
}

test("does not transfer robustness confidence into an unseen regime", () => {
  const windows = [
    windowResult(0, 100),
    windowResult(1, 200),
    windowResult(2, 300),
    windowResult(3, 400)
  ];
  const evaluation = evaluateStrategyByRegime(
    experiment(windows),
    [
      regime(0, "HEALTHY", 99),
      regime(1, "HEALTHY", 199),
      regime(2, "MIXED", 299),
      regime(3, "MIXED", 399)
    ],
    { minimumWindowsPerRegime: 2 }
  );

  assert.equal(evaluation.observedRegimeCount, 2);
  assert.equal(evaluation.sufficientRegimeCount, 2);
  assert.equal(evaluation.regimeRobustnessScore, undefined);
  assert.ok(evaluation.reasons.includes("UNSEEN_REGIME_EVIDENCE"));
  assert.ok(evaluation.reasons.includes("INSUFFICIENT_REGIME_COVERAGE"));
  assert.ok(evaluation.reasons.includes("INSUFFICIENT_ROBUSTNESS_EVIDENCE"));
  assert.deepEqual(evaluation.slices.find((slice) => slice.regime === "STRESSED").reasons, ["REGIME_NOT_OBSERVED"]);
});

test("emits robustness only when every canonical regime has sufficient OOS evidence", () => {
  const states = ["HEALTHY", "HEALTHY", "MIXED", "MIXED", "STRESSED", "STRESSED"];
  const windows = states.map((_, index) => windowResult(index, (index + 1) * 100));
  const evidence = states.map((state, index) => regime(index, state, (index + 1) * 100 - 1));
  const evaluation = evaluateStrategyByRegime(experiment(windows), evidence, { minimumWindowsPerRegime: 2 });

  assert.equal(evaluation.observedRegimeCount, 3);
  assert.equal(evaluation.sufficientRegimeCount, 3);
  assert.equal(typeof evaluation.regimeRobustnessScore, "number");
  assert.equal(evaluation.reasons.includes("UNSEEN_REGIME_EVIDENCE"), false);
  assert.equal(evaluation.reasons.includes("INSUFFICIENT_REGIME_COVERAGE"), false);
});
