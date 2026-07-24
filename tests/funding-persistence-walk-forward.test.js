const test = require("node:test");
const assert = require("node:assert/strict");
const { runFundingPersistenceWalkForward } = require("../dist/apps/cloud/src/alpha/funding/FundingPersistenceWalkForward.js");

const metric = (overrides = {}) => Object.freeze({
  totalReturn: 0.1,
  cagr: 0.12,
  annualizedVolatility: 0.2,
  sharpe: 1.5,
  sortino: 1.8,
  calmar: 1.2,
  maximumDrawdown: 0.08,
  winRate: 0.6,
  profitFactor: 1.4,
  expectancy: 100,
  recoveryFactor: 1.5,
  turnover: 2,
  exposure: 0.5,
  closedTrades: 10,
  ...overrides
});

const candle = (i) => Object.freeze({
  candleId: `C-${i}`,
  market: "BTCUSDT",
  openTime: new Date(Date.UTC(2026, 0, 1, i, 0, 0)).toISOString(),
  closeTime: new Date(Date.UTC(2026, 0, 1, i + 1, 0, 0)).toISOString(),
  open: 100 + i,
  high: 101 + i,
  low: 99 + i,
  close: 100 + i,
  fundingRate: 0
});

const candles = Array.from({ length: 12 }, (_, i) => candle(i));
const policy = Object.freeze({
  engineVersion: 1,
  mode: "ROLLING",
  minimumTrainCandles: 4,
  minimumTestCandles: 2,
  selectionMetric: "SHARPE",
  minimumOosSharpe: 1,
  maximumOosDrawdown: 0.15,
  minimumPositiveWindowRatio: 0.5,
  maximumCandidateSwitchRatio: 0.5
});

const window = (id, trainStart, trainEnd, testStart, testEnd, aTrain, aTest, bTrain, bTest) => Object.freeze({
  windowId: id,
  trainStartIndex: trainStart,
  trainEndIndexExclusive: trainEnd,
  testStartIndex: testStart,
  testEndIndexExclusive: testEnd,
  candidateResults: Object.freeze([
    Object.freeze({ candidateId: "A", trainMetrics: aTrain, testMetrics: aTest }),
    Object.freeze({ candidateId: "B", trainMetrics: bTrain, testMetrics: bTest })
  ])
});

test("selects candidates from train metrics only and evaluates OOS", () => {
  const windows = [
    window("W1", 0, 4, 4, 6, metric({ sharpe: 2 }), metric({ sharpe: 1.3, totalReturn: 0.05 }), metric({ sharpe: 1 }), metric({ sharpe: 3, totalReturn: 0.4 })),
    window("W2", 2, 6, 6, 8, metric({ sharpe: 2.2 }), metric({ sharpe: 1.4, totalReturn: 0.06 }), metric({ sharpe: 1.1 }), metric({ sharpe: 4, totalReturn: 0.5 }))
  ];
  const result = runFundingPersistenceWalkForward(candles, windows, "2026-01-02T00:00:00.000Z", policy);
  assert.equal(result.windows[0].selectedCandidateId, "A");
  assert.equal(result.windows[1].selectedCandidateId, "A");
  assert.equal(result.aggregate.passed, true);
  assert.equal(result.aggregate.candidateSwitchRatio, 0);
  assert.ok(result.aggregate.stabilityScore > 0);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.windows));
});

test("fails aggregate when OOS windows are weak or unstable", () => {
  const windows = [
    window("W1", 0, 4, 4, 6, metric({ sharpe: 2 }), metric({ sharpe: 0.2, totalReturn: -0.02, maximumDrawdown: 0.2 }), metric({ sharpe: 1 }), metric()),
    window("W2", 2, 6, 6, 8, metric({ sharpe: 1 }), metric(), metric({ sharpe: 2 }), metric({ sharpe: 0.4, totalReturn: -0.01 }))
  ];
  const result = runFundingPersistenceWalkForward(candles, windows, "2026-01-02T00:00:00.000Z", policy);
  assert.equal(result.aggregate.passed, false);
  assert.ok(result.aggregate.reasons.includes("ONE_OR_MORE_WINDOWS_FAILED"));
  assert.equal(result.aggregate.candidateSwitchRatio, 1);
});

test("supports anchored windows", () => {
  const anchored = { ...policy, mode: "ANCHORED" };
  const windows = [
    window("W1", 0, 4, 4, 6, metric({ sharpe: 2 }), metric(), metric({ sharpe: 1 }), metric()),
    window("W2", 0, 6, 6, 8, metric({ sharpe: 2 }), metric(), metric({ sharpe: 1 }), metric())
  ];
  const result = runFundingPersistenceWalkForward(candles, windows, "2026-01-02T00:00:00.000Z", anchored);
  assert.equal(result.mode, "ANCHORED");
});

test("rejects overlap, duplicate IDs, bad windows, and invalid mode progression", () => {
  const valid = window("W1", 0, 4, 4, 6, metric({ sharpe: 2 }), metric(), metric({ sharpe: 1 }), metric());
  assert.throws(() => runFundingPersistenceWalkForward(candles, [valid, valid], "2026-01-02T00:00:00.000Z", policy), /duplicate window/);
  const overlap = window("W2", 2, 6, 5, 7, metric(), metric(), metric(), metric());
  assert.throws(() => runFundingPersistenceWalkForward(candles, [overlap], "2026-01-02T00:00:00.000Z", policy), /must not overlap/);
  const nonAdvancing = window("W2", 0, 6, 6, 8, metric(), metric(), metric(), metric());
  assert.throws(() => runFundingPersistenceWalkForward(candles, [valid, nonAdvancing], "2026-01-02T00:00:00.000Z", policy), /must advance/);
});

test("is deterministic and hashes full result", () => {
  const windows = [window("W1", 0, 4, 4, 6, metric({ sharpe: 2 }), metric(), metric({ sharpe: 1 }), metric())];
  const first = runFundingPersistenceWalkForward(candles, windows, "2026-01-02T00:00:00.000Z", policy);
  const second = runFundingPersistenceWalkForward(candles, windows, "2026-01-02T00:00:00.000Z", policy);
  assert.deepEqual(first, second);
  assert.match(first.resultHash, /^[a-f0-9]{64}$/);
});