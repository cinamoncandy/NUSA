const assert = require("node:assert/strict");
const test = require("node:test");
const { parseNaturalLanguageStrategy, validateStrategy, StrategyRegistry } = require("../dist/apps/mobile/src/aiStrategyEngine.js");
const { InMemoryStrategyOptimizerRunRepository } = require("../dist/apps/mobile/src/aiStrategyOptimizer.js");
const { evaluateAiSystem, evaluateRecommendationBenchmark, replayBacktestForEvaluation, replayOptimizerForEvaluation } = require("../dist/apps/mobile/src/aiEvaluationEngine.js");

const dataset = { version: "paper-dataset-v1", checksum: "a".repeat(64) };
const source = "Buy when price above 100 on KRW-BTC in sideways, take profit 5%, stop loss 2%, risk 1%, position size 10%, max position 100000";

function candle(timestamp, close, high = close + 1, low = close - 1) { return { timestamp, open: close, high, low, close, volume: 10 }; }
function strategy() {
  const parsed = parseNaturalLanguageStrategy(source, { strategyId: "evaluation-base", version: "1.0.0", now: 1, datasetVersion: dataset.version, datasetChecksum: dataset.checksum });
  const validated = validateStrategy({ ...parsed.strategy, status: "VALIDATED" });
  assert.equal(validated.status, "VALIDATED");
  return validated.strategy;
}
function candles() {
  const window = [candle(1_000, 90), candle(2_000, 105), candle(3_000, 111, 112, 110), candle(4_000, 90)];
  return [...window, ...window.map((item) => ({ ...item, timestamp: item.timestamp + 10_000 })), ...window.map((item) => ({ ...item, timestamp: item.timestamp + 20_000 }))];
}
function recommendations() {
  return [
    { caseId: "case-1", dataset, expectedAction: "BUY", actualAction: "BUY", confidence: 0.9, outcome: "SUCCESS" },
    { caseId: "case-2", dataset, expectedAction: "SELL", actualAction: "BUY", confidence: 0.6, outcome: "FAILURE" },
    { caseId: "case-3", dataset, expectedAction: "HOLD", actualAction: "HOLD", confidence: 0.7, outcome: "UNKNOWN" }
  ];
}
function evaluationInput(overrides = {}) {
  const value = strategy();
  const registry = new StrategyRegistry();
  registry.register(value);
  const backtest = { candles: candles(), dataset, strategy: value, registry, config: { initialCash: 1_000, feeRate: 0, slippageBps: 0 } };
  const optimizerCore = {
    candles: candles(), dataset, strategy: value, registry, parameterGrid: { entryPrice: [100, 110] },
    config: { split: { trainSize: 4, validationSize: 4, holdoutSize: 4, stepSize: 4 }, holdout: { minimumClosedTrades: 1, minimumReturn: 0, maximumDrawdown: 0.5, minimumProfitFactor: 1 } }
  };
  const baselineBacktest = replayBacktestForEvaluation({ input: backtest });
  const baselineOptimizer = replayOptimizerForEvaluation({ input: optimizerCore, createRepository: () => new InMemoryStrategyOptimizerRunRepository() });
  return {
    dataset,
    backtest,
    optimizer: { input: optimizerCore, createRepository: () => new InMemoryStrategyOptimizerRunRepository() },
    recommendations: recommendations(),
    config: { minimumEvaluatedRecommendations: 2, baseline: { backtestSerialized: baselineBacktest.serialized, optimizerSerialized: baselineOptimizer.serialized } },
    ...overrides
  };
}

test("benchmarks recommendation accuracy, outcomes, coverage and calibration", () => {
  const result = evaluateRecommendationBenchmark(recommendations(), dataset);
  assert.equal(result.totalCases, 3);
  assert.equal(result.evaluatedCases, 2);
  assert.equal(result.accuracy, 2 / 3);
  assert.equal(result.successRate, 0.5);
  assert.equal(result.coverage, 2 / 3);
  assert.equal(result.calibrationError, 0.35);
  assert.ok(result.benchmarkScore > 0);
});

test("passes deterministic replay, provenance, safety, holdout and regression gates", () => {
  const report = evaluateAiSystem(evaluationInput());
  assert.equal(report.overallStatus, "PASS");
  assert.deepEqual(report.gates, { replayDeterministic: true, datasetProvenance: true, safetyBoundary: true, holdoutPassed: true, recommendationSample: true, regressionPassed: true });
  assert.equal(report.backtestReplay.matched, true);
  assert.equal(report.optimizerReplay.matched, true);
  assert.equal(report.safety.mutationAllowed, false);
});

test("repeated evaluation is deterministic and does not mutate the Strategy Registry", () => {
  const firstInput = evaluationInput();
  const first = evaluateAiSystem(firstInput);
  const second = evaluateAiSystem(evaluationInput());
  assert.deepEqual(first, second);
  assert.equal(firstInput.backtest.registry.list().length, 1);
});

test("baseline drift and insufficient labeled outcomes fail the evaluation gate", () => {
  const value = evaluationInput();
  const report = evaluateAiSystem({ ...value, config: { ...value.config, baseline: { ...value.config.baseline, optimizerSerialized: "tampered" } } });
  assert.equal(report.overallStatus, "FAIL");
  assert.equal(report.regression.status, "FAIL");
  const insufficient = evaluateAiSystem({ ...evaluationInput(), config: { ...value.config, minimumEvaluatedRecommendations: 3 } });
  assert.equal(insufficient.overallStatus, "FAIL");
  assert.equal(insufficient.gates.recommendationSample, false);
});

test("invalid provenance, duplicate cases and replay repository reuse fail closed", () => {
  assert.throws(() => evaluateAiSystem({ ...evaluationInput(), recommendations: [{ ...recommendations()[0], dataset: { ...dataset, version: "other" } }] }), /PROVENANCE_MISMATCH/);
  assert.throws(() => evaluateRecommendationBenchmark([recommendations()[0], recommendations()[0]], dataset), /DUPLICATE_CASE/);
  const sharedRepository = new InMemoryStrategyOptimizerRunRepository();
  const value = evaluationInput();
  assert.throws(() => evaluateAiSystem({ ...value, optimizer: { ...value.optimizer, createRepository: () => sharedRepository } }), /REPOSITORY_REUSE/);
});
