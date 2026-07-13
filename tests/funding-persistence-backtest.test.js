const test = require("node:test");
const assert = require("node:assert/strict");
const { runFundingPersistenceBacktest } = require("../dist/apps/cloud/src/alpha/funding/FundingPersistenceBacktest.js");

const policy = Object.freeze({
  engineVersion: 1,
  initialCapital: 100000,
  allocationFraction: 0.5,
  takerFeeRate: 0.001,
  slippageRate: 0.001,
  borrowRatePerCandle: 0.0001,
  periodsPerYear: 365 * 24,
  closeOpenPositionAtEnd: true
});

const candle = (index, open, close, fundingRate = 0) => Object.freeze({
  candleId: `C-${index}`,
  market: "BTCUSDT",
  openTime: new Date(Date.UTC(2026, 0, 1, index, 0, 0)).toISOString(),
  closeTime: new Date(Date.UTC(2026, 0, 1, index + 1, 0, 0)).toISOString(),
  open,
  high: Math.max(open, close) * 1.01,
  low: Math.min(open, close) * 0.99,
  close,
  fundingRate
});

const decision = (id, hour, action, targetPosition, eligible = true) => Object.freeze({
  decisionId: id,
  strategyId: "FUNDING_PERSISTENCE_MEAN_REVERSION",
  strategyVersion: 1,
  market: "BTCUSDT",
  generatedAt: new Date(Date.UTC(2026, 0, 1, hour, 30, 0)).toISOString(),
  action,
  targetPosition,
  signalStrength: eligible ? 0.8 : 0,
  eligible,
  reasons: Object.freeze([eligible ? "TEST" : "ABSTAIN"]),
  featureVersion: 1,
  featureGeneratedAt: new Date(Date.UTC(2026, 0, 1, hour, 20, 0)).toISOString(),
  featureProvenance: Object.freeze([`S-${hour}`])
});

test("executes a long signal on the next candle open and closes deterministically", () => {
  const candles = [
    candle(0, 100, 100),
    candle(1, 100, 105),
    candle(2, 105, 110),
    candle(3, 110, 108)
  ];
  const decisions = [
    decision("D-1", 0, "ENTER_LONG", "LONG"),
    decision("D-2", 2, "EXIT", "FLAT")
  ];
  const first = runFundingPersistenceBacktest(candles, decisions, policy);
  const second = runFundingPersistenceBacktest(candles, decisions, policy);
  assert.deepEqual(first, second);
  assert.equal(first.fills[0].executedAt, candles[1].openTime);
  assert.equal(first.fills[0].action, "ENTER_LONG");
  assert.equal(first.fills[1].executedAt, candles[3].openTime);
  assert.equal(first.fills[1].action, "EXIT");
  assert.equal(first.trades.length, 1);
  assert.ok(first.trades[0].netPnl > 0);
  assert.ok(first.finalEquity > policy.initialCapital);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.fills));
});

test("supports short positions, funding income, borrow cost, and forced close", () => {
  const candles = [
    candle(0, 100, 100, 0.0005),
    candle(1, 100, 95, 0.0005),
    candle(2, 95, 90, 0.0005)
  ];
  const result = runFundingPersistenceBacktest(
    candles,
    [decision("D-SHORT", 0, "ENTER_SHORT", "SHORT")],
    policy
  );
  assert.equal(result.fills[0].action, "ENTER_SHORT");
  assert.equal(result.fills.at(-1).action, "FORCED_EXIT");
  assert.equal(result.trades[0].side, "SHORT");
  assert.ok(result.trades[0].fundingPnl > 0);
  assert.ok(result.trades[0].borrowCost > 0);
  assert.ok(result.trades[0].netPnl > 0);
});

test("reverses through an audited close then open at one candle open", () => {
  const candles = [
    candle(0, 100, 100),
    candle(1, 100, 102),
    candle(2, 102, 98),
    candle(3, 98, 97)
  ];
  const decisions = [
    decision("D-LONG", 0, "ENTER_LONG", "LONG"),
    decision("D-SHORT", 1, "ENTER_SHORT", "SHORT")
  ];
  const result = runFundingPersistenceBacktest(candles, decisions, policy);
  assert.equal(result.fills[0].action, "ENTER_LONG");
  assert.equal(result.fills[1].action, "EXIT");
  assert.equal(result.fills[2].action, "ENTER_SHORT");
  assert.equal(result.fills[1].executedAt, candles[2].openTime);
  assert.equal(result.fills[2].executedAt, candles[2].openTime);
  assert.equal(result.trades.length, 2);
});

test("ignores hold and abstain decisions without changing position", () => {
  const candles = [candle(0, 100, 100), candle(1, 100, 101), candle(2, 101, 102)];
  const decisions = [
    decision("D-A", 0, "ABSTAIN", "FLAT", false),
    decision("D-H", 1, "HOLD", "FLAT", true)
  ];
  const result = runFundingPersistenceBacktest(candles, decisions, policy);
  assert.equal(result.fills.length, 0);
  assert.equal(result.trades.length, 0);
  assert.equal(result.finalEquity, policy.initialCapital);
  assert.equal(result.metrics.totalReturn, 0);
});

test("models fees and slippage as real performance drag", () => {
  const candles = [candle(0, 100, 100), candle(1, 100, 100), candle(2, 100, 100)];
  const decisions = [decision("D-1", 0, "ENTER_LONG", "LONG")];
  const free = runFundingPersistenceBacktest(candles, decisions, {
    ...policy,
    takerFeeRate: 0,
    slippageRate: 0,
    borrowRatePerCandle: 0
  });
  const costly = runFundingPersistenceBacktest(candles, decisions, policy);
  assert.equal(free.finalEquity, policy.initialCapital);
  assert.ok(costly.finalEquity < free.finalEquity);
  assert.ok(costly.trades[0].fees > 0);
});

test("rejects duplicate candles, duplicate decisions, mixed markets, and invalid OHLC", () => {
  const valid = [candle(0, 100, 100), candle(1, 100, 100)];
  assert.throws(() => runFundingPersistenceBacktest([valid[0], valid[0]], [], policy), /duplicate candle/);
  const d = decision("D-X", 0, "ABSTAIN", "FLAT", false);
  assert.throws(() => runFundingPersistenceBacktest(valid, [d, d], policy), /duplicate decision/);
  assert.throws(() => runFundingPersistenceBacktest([
    valid[0],
    Object.freeze({ ...valid[1], market: "ETHUSDT" })
  ], [], policy), /one market/);
  assert.throws(() => runFundingPersistenceBacktest([
    valid[0],
    Object.freeze({ ...valid[1], high: 90 })
  ], [], policy), /invalid OHLC/);
});

test("rejects same-open execution and only consumes strictly earlier decisions", () => {
  const candles = [candle(0, 100, 100), candle(1, 100, 101), candle(2, 101, 102)];
  const sameOpen = Object.freeze({
    ...decision("D-SAME", 0, "ENTER_LONG", "LONG"),
    generatedAt: candles[1].openTime
  });
  const result = runFundingPersistenceBacktest(candles, [sameOpen], policy);
  assert.equal(result.fills[0].executedAt, candles[2].openTime);
});

test("calculates drawdown, turnover, exposure, and closed trade metrics", () => {
  const candles = [
    candle(0, 100, 100),
    candle(1, 100, 110),
    candle(2, 110, 80),
    candle(3, 80, 85)
  ];
  const result = runFundingPersistenceBacktest(candles, [decision("D-1", 0, "ENTER_LONG", "LONG")], policy);
  assert.ok(result.metrics.maximumDrawdown > 0);
  assert.ok(result.metrics.turnover > 0);
  assert.ok(result.metrics.exposure > 0);
  assert.equal(result.metrics.closedTrades, 1);
  assert.equal(result.equityCurve.at(-1).position, "FLAT");
});
