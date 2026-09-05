const assert = require("node:assert/strict");
const test = require("node:test");
const { parseNaturalLanguageStrategy, validateStrategy, StrategyRegistry } = require("../dist/apps/mobile/src/aiStrategyEngine.js");
const { InMemoryStrategyOptimizerRunRepository, generateStrategyCandidates, runStrategyOptimization } = require("../dist/apps/mobile/src/aiStrategyOptimizer.js");

const checksum = "a".repeat(64);
const dataset = { version: "paper-dataset-v1", checksum };
const source = "Buy when price above 100 on KRW-BTC in sideways, take profit 5%, stop loss 2%, risk 1%, position size 10%, max position 100000";

function strategy() {
  const parsed = parseNaturalLanguageStrategy(source, { strategyId: "optimizer-base", version: "1.0.0", now: 1, datasetVersion: dataset.version, datasetChecksum: dataset.checksum });
  assert.equal(parsed.status, "DRAFT");
  const validated = validateStrategy({ ...parsed.strategy, status: "VALIDATED" });
  assert.equal(validated.status, "VALIDATED");
  return validated.strategy;
}

function candle(timestamp, close, high = close + 1, low = close - 1) { return { timestamp, open: close, high, low, close, volume: 10 }; }
function candles(holdoutEntry = 100) {
  const window = [candle(1_000, 90), candle(2_000, holdoutEntry === 100 ? 105 : 111), candle(3_000, 111, 112, 110), candle(4_000, 90)];
  return [...window, ...window.map((item, _index) => ({ ...item, timestamp: item.timestamp + 10_000 })), ...window.map((item, _index) => ({ ...item, timestamp: item.timestamp + 20_000 }))];
}

function input(overrides = {}) {
  const value = strategy();
  const registry = new StrategyRegistry();
  registry.register(value);
  return {
    candles: candles(), dataset, strategy: value, registry, parameterGrid: { entryPrice: [100, 110] },
    config: { split: { trainSize: 4, validationSize: 4, holdoutSize: 4, stepSize: 4 }, holdout: { minimumClosedTrades: 1, minimumReturn: 0, maximumDrawdown: 0.5, minimumProfitFactor: 1 } },
    repository: new InMemoryStrategyOptimizerRunRepository(), ...overrides
  };
}

test("generates a deterministic, bounded candidate grid", () => {
  const base = strategy();
  const candidates = generateStrategyCandidates(base, { entryPrice: [100, 110] }, 4);
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((candidate) => candidate.version), ["1.0.1", "1.0.2"]);
  assert.deepEqual(candidates.map((candidate) => candidate.dsl.entry.price), [100, 110]);
  assert.throws(() => generateStrategyCandidates(base, { entryPrice: [100, 101, 102] }, 2), /CANDIDATE_LIMIT/);
});

test("optimizes on train/validation, evaluates holdout once, and creates an approval-gated promotion candidate", () => {
  const value = input();
  const report = runStrategyOptimization(value);
  assert.equal(report.candidates.length, 2);
  assert.equal(report.selectedCandidate.strategy.dsl.entry.price, 100);
  assert.equal(report.selectedCandidate.windows[0].validationEnd <= value.candles.length - value.config.split.holdoutSize, true);
  assert.equal(report.holdout.passed, true);
  assert.equal(report.promotionCandidate.status, "PENDING_OWNER_APPROVAL");
  assert.equal(report.promotionCandidate.requiresOwnerApproval, true);
  assert.equal(report.promotionCandidate.ownerApproved, false);
  assert.equal(report.promotionCandidate.existingStrategyReplaced, false);
  assert.deepEqual(report.dataset, dataset);
  assert.deepEqual(report.safety, { researchOnly: true, paperOnly: true, liveMutationAllowed: false, holdoutRequired: true, existingStrategyReplaced: false });
  assert.equal(value.registry.list().length, 1);
  assert.deepEqual(value.repository.load(report.runId), report);
});

test("walk-forward windows never consume the reserved holdout", () => {
  const baseInput = input();
  const longCandles = [...baseInput.candles, ...baseInput.candles.slice(0, 4).map((item) => ({ ...item, timestamp: item.timestamp + 30_000 }))];
  const report = runStrategyOptimization({ ...baseInput, candles: longCandles });
  assert.equal(report.selectedCandidate.windows.length, 2);
  assert.ok(report.selectedCandidate.windows.every((window) => window.validationEnd <= longCandles.length - report.split.holdoutSize));
  assert.equal(report.holdout.reportId.startsWith("backtest:optimizer-base:"), true);
});

test("same inputs produce the same result while the repository blocks dataset reuse", () => {
  const first = runStrategyOptimization(input());
  const second = runStrategyOptimization(input());
  assert.deepEqual(first, second);
  assert.throws(() => runStrategyOptimization({ ...input({ repository: new InMemoryStrategyOptimizerRunRepository() }), dataset: { ...dataset, version: "other" } }), /DATASET_PROVENANCE_MISMATCH|STRATEGY_NOT_REGISTERED/);
  const reusableRepository = new InMemoryStrategyOptimizerRunRepository();
  runStrategyOptimization(input({ repository: reusableRepository }));
  assert.throws(() => runStrategyOptimization(input({ repository: reusableRepository })), /DATASET_REUSE_BLOCKED/);
});

test("holdout failure blocks promotion and invalid inputs fail closed", () => {
  const base = strategy();
  const registry = new StrategyRegistry();
  registry.register(base);
  const repository = new InMemoryStrategyOptimizerRunRepository();
  const result = runStrategyOptimization({ ...input({ registry, repository, parameterGrid: { entryPrice: [110] } }), candles: candles(110) });
  assert.equal(result.holdout.passed, false);
  assert.equal(result.promotionCandidate, null);
  assert.throws(() => runStrategyOptimization({ ...input({ parameterGrid: { entryPrice: [0] } }) }), /invalid parameter grid/);
  assert.throws(() => runStrategyOptimization({ ...input(), dataset: { version: dataset.version, checksum: "bad" } }), /SHA-256/);
});
