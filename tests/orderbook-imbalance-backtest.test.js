const test = require("node:test");
const assert = require("node:assert/strict");
const { computeOrderbookImbalanceFeature } = require("../dist/apps/cloud/src/alpha/orderbook/OrderbookImbalanceFeature.js");
const {
  createInitialOrderbookImbalanceStrategyState,
  evaluateOrderbookImbalanceStrategy
} = require("../dist/apps/cloud/src/alpha/orderbook/OrderbookImbalanceStrategy.js");
const { runOrderbookImbalanceBacktest } = require("../dist/apps/cloud/src/alpha/orderbook/OrderbookImbalanceBacktest.js");

const featurePolicy = {
  featureVersion: 1,
  depthLevels: 2,
  minimumTotalQuantity: 1,
  maximumSpreadRate: 0.05,
  staleAfterMs: 1000
};
const strategyPolicy = {
  strategyVersion: 1,
  minimumBookImbalance: 0.2,
  minimumQueueImbalance: 0.2,
  minimumMicropriceDeviationRate: 0.0001,
  maximumEntrySpreadRate: 0.05,
  exitImbalanceAbsolute: 0.1,
  stopMicropriceDeviationRate: 0.01,
  maximumHoldingSnapshots: 10,
  cooldownSnapshots: 1,
  maximumConsecutiveLosses: 3
};
const backtestPolicy = {
  engineVersion: 1,
  initialEquity: 10000,
  notionalPerTrade: 1000,
  takerFeeRate: 0.001,
  slippageRate: 0.0005,
  maximumParticipationRate: 0.5,
  annualizationFactor: 252
};

const snapshot = (id, minute, bid, ask, bidQty, askQty) => ({
  snapshotId: id,
  market: "BTCUSDT",
  capturedAt: new Date(Date.UTC(2026, 0, 1, 0, minute, 0)).toISOString(),
  bids: [{ price: bid, quantity: bidQty }, { price: bid - 1, quantity: bidQty / 2 }],
  asks: [{ price: ask, quantity: askQty }, { price: ask + 1, quantity: askQty / 2 }],
  sequence: minute,
  source: "TEST"
});

const feature = (snap) => computeOrderbookImbalanceFeature(snap, snap.capturedAt, featurePolicy);

const buildInput = () => {
  const features = [
    feature(snapshot("S1", 0, 99, 100, 20, 2)),
    feature(snapshot("S2", 1, 100, 101, 18, 3)),
    feature(snapshot("S3", 2, 104, 105, 10, 10)),
    feature(snapshot("S4", 3, 105, 106, 10, 10))
  ];
  let state = createInitialOrderbookImbalanceStrategyState();
  const enter = evaluateOrderbookImbalanceStrategy("D1", features[0], state, strategyPolicy);
  state = enter.nextState;
  const holdOrExit = evaluateOrderbookImbalanceStrategy("D2", features[1], state, strategyPolicy);
  state = holdOrExit.nextState;
  const exit = evaluateOrderbookImbalanceStrategy("D3", features[2], state, strategyPolicy);
  return { features, decisions: [enter, holdOrExit, exit] };
};

test("executes decisions on the next snapshot and produces deterministic metrics", () => {
  const input = buildInput();
  const first = runOrderbookImbalanceBacktest(input, "2026-01-02T00:00:00.000Z", backtestPolicy);
  const second = runOrderbookImbalanceBacktest(input, "2026-01-02T00:00:00.000Z", backtestPolicy);
  assert.deepEqual(first, second);
  assert.match(first.resultHash, /^[a-f0-9]{64}$/);
  assert.equal(first.fills[0].featureSnapshotId, "S1");
  assert.equal(first.fills[0].executionSnapshotId, "S2");
  assert.equal(first.metrics.tradeCount, 1);
  assert.ok(first.metrics.finalEquity > 0);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.fills));
});

test("includes fee, slippage, turnover, exposure, and drawdown metrics", () => {
  const result = runOrderbookImbalanceBacktest(buildInput(), "2026-01-02T00:00:00.000Z", backtestPolicy);
  assert.ok(result.metrics.totalFees > 0);
  assert.ok(result.metrics.totalSlippageCost > 0);
  assert.ok(result.metrics.turnover > 0);
  assert.ok(result.metrics.exposureRatio > 0);
  assert.ok(result.metrics.maxDrawdown >= 0);
  assert.ok(Number.isFinite(result.metrics.sharpe));
  assert.ok(Number.isFinite(result.metrics.sortino));
});

test("fails closed on duplicate decisions and missing feature references", () => {
  const input = buildInput();
  assert.throws(
    () => runOrderbookImbalanceBacktest({ features: input.features, decisions: [input.decisions[0], input.decisions[0]] }, "2026-01-02T00:00:00.000Z", backtestPolicy),
    /duplicate decision/
  );
  const broken = Object.freeze({ ...input.decisions[0], featureSnapshotId: "MISSING" });
  assert.throws(
    () => runOrderbookImbalanceBacktest({ features: input.features, decisions: [broken] }, "2026-01-02T00:00:00.000Z", backtestPolicy),
    /references missing feature/
  );
});

test("caps fill quantity by visible depth participation", () => {
  const policy = { ...backtestPolicy, notionalPerTrade: 1000000, maximumParticipationRate: 0.1 };
  const result = runOrderbookImbalanceBacktest(buildInput(), "2026-01-02T00:00:00.000Z", policy);
  assert.ok(result.fills[0].quantity <= buildInput().features[1].askQuantity * 0.1 + 1e-9);
});
