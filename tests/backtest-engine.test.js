const test = require("node:test");
const assert = require("node:assert/strict");
const { runBacktest } = require("../dist/apps/desktop/src/strategy/backtestEngine.js");

class BuyHoldSellStrategy {
  constructor() { this.id = "buy-hold-sell"; this.name = "Buy Hold Sell"; this.index = 0; }
  onTick(tick) {
    this.index += 1;
    const type = this.index === 1 ? "BUY" : this.index === 3 ? "SELL" : "HOLD";
    return { type, reason: `step-${this.index}`, confidence: 0, timestamp: tick.timestamp };
  }
  reset() { this.index = 0; }
}

class AlwaysBuyStrategy {
  constructor() { this.id = "always-buy"; this.name = "Always Buy"; }
  onTick(tick) { return { type: "BUY", reason: "test", confidence: 0, timestamp: tick.timestamp }; }
  reset() {}
}

class ThresholdOnceStrategy {
  constructor() { this.id = "threshold-once"; this.name = "Threshold Once"; this.emitted = false; }
  onTick(tick) {
    if (!this.emitted && tick.price >= 100) {
      this.emitted = true;
      return { type: "BUY", reason: "close-threshold", confidence: 0, timestamp: tick.timestamp };
    }
    return { type: "HOLD", reason: "no-signal", confidence: 0, timestamp: tick.timestamp };
  }
  reset() { this.emitted = false; }
}

const points = [
  { timestamp: Date.parse("2026-01-01T00:00:00Z"), close: 100 },
  { timestamp: Date.parse("2026-01-01T00:01:00Z"), close: 120 },
  { timestamp: Date.parse("2026-01-01T00:02:00Z"), close: 110 },
  { timestamp: Date.parse("2026-01-01T00:03:00Z"), close: 105 }
];

test("backtest reuses Paper accounting and records replayable next-observation decisions", () => {
  const config = { initialCash: 1_000, feeRate: 0.01, orderQuantity: 1 };
  const first = runBacktest(points, () => new BuyHoldSellStrategy(), config);
  const replay = runBacktest(points, () => new BuyHoldSellStrategy(), config);

  assert.deepEqual(replay, first);
  assert.deepEqual(first.decisions.map((decision) => decision.outcome), ["FILLED", "HOLD", "FILLED", "HOLD"]);
  assert.deepEqual(first.decisions.map((decision) => decision.signal.type), ["BUY", "HOLD", "SELL", "HOLD"]);
  assert.equal(first.decisions[0].signalTimestamp, points[0].timestamp);
  assert.equal(first.decisions[0].executionTimestamp, points[1].timestamp);
  assert.equal(first.decisions[0].executionMarketPrice, points[1].close);
  assert.equal(first.decisions[0].executionPrice, points[1].close);
  assert.equal(first.decisions[2].signalTimestamp, points[2].timestamp);
  assert.equal(first.decisions[2].executionTimestamp, points[3].timestamp);
  assert.equal(first.decisions[2].executionMarketPrice, points[3].close);
  assert.equal(first.decisions[2].executionPrice, points[3].close);
  assert.equal(first.finalPaperState.orders.length, 2);
  assert.equal(first.finalPaperState.position.quantity, 0);
  assert.equal(first.metrics.fillCount, 2);
  assert.equal(first.metrics.rejectionCount, 0);
  assert.equal(first.metrics.turnover, 0.225);
  assert.equal(first.metrics.spreadCost, 0);
  assert.equal(first.metrics.slippageCost, 0);
  assert.equal(first.metrics.totalTradingCost, first.metrics.feesPaid);
  assert.ok(Math.abs(first.metrics.finalEquity - 982.75) < 1e-9);
  assert.ok(Math.abs(first.metrics.totalReturn - (-0.01725)) < 1e-12);
  assert.ok(first.metrics.maxDrawdown > 0);
  assert.ok(first.metrics.benchmarkReturn > first.metrics.totalReturn);
  assert.equal(first.metrics.excessReturn, first.metrics.totalReturn - first.metrics.benchmarkReturn);
});

test("spread and slippage apply to the actual next-observation execution price", () => {
  const result = runBacktest(points, () => new BuyHoldSellStrategy(), {
    initialCash: 1_000,
    feeRate: 0.01,
    orderQuantity: 1,
    executionCosts: { spreadBps: 20, slippageBps: 30 }
  });

  assert.ok(Math.abs(result.decisions[0].executionPrice - 120.48) < 1e-12);
  assert.ok(Math.abs(result.decisions[2].executionPrice - 104.58) < 1e-12);
  assert.ok(Math.abs(result.metrics.finalEquity - 981.8494) < 1e-9);
  assert.ok(Math.abs(result.metrics.turnover - 0.22506) < 1e-12);
  assert.ok(Math.abs(result.metrics.feesPaid - 2.2506) < 1e-12);
  assert.ok(Math.abs(result.metrics.spreadCost - 0.225) < 1e-12);
  assert.ok(Math.abs(result.metrics.slippageCost - 0.675) < 1e-12);
  assert.ok(Math.abs(result.metrics.totalTradingCost - 3.1506) < 1e-12);
  assert.ok(result.metrics.totalReturn < -0.01725);
});

test("a signal caused by close(t) cannot fill at close(t) or timestamp(t)", () => {
  const causalPoints = [
    { timestamp: 1_000, close: 90 },
    { timestamp: 2_000, close: 101 },
    { timestamp: 3_000, close: 80 }
  ];
  const result = runBacktest(causalPoints, () => new ThresholdOnceStrategy(), {
    initialCash: 1_000,
    feeRate: 0,
    orderQuantity: 1
  });

  const decision = result.decisions[1];
  assert.equal(decision.signal.type, "BUY");
  assert.equal(decision.price, 101);
  assert.equal(decision.signalTimestamp, 2_000);
  assert.equal(decision.executionMarketPrice, 80);
  assert.equal(decision.executionPrice, 80);
  assert.equal(decision.executionTimestamp, 3_000);
  assert.equal(decision.outcome, "FILLED");
  assert.notEqual(decision.executionTimestamp, decision.signalTimestamp);
  assert.notEqual(decision.executionPrice, decision.price);
});

test("terminal actionable signal remains explicitly unfilled when no next observation exists", () => {
  const result = runBacktest(
    [{ timestamp: 1_000, close: 90 }, { timestamp: 2_000, close: 101 }],
    () => new ThresholdOnceStrategy(),
    { initialCash: 1_000, feeRate: 0, orderQuantity: 1 }
  );

  const terminal = result.decisions[1];
  assert.equal(terminal.signal.type, "BUY");
  assert.equal(terminal.outcome, "UNFILLED");
  assert.equal(terminal.unfilledReason, "NO_NEXT_OBSERVATION");
  assert.equal(terminal.executionTimestamp, undefined);
  assert.equal(terminal.executionPrice, undefined);
  assert.equal(terminal.order, undefined);
  assert.equal(result.metrics.fillCount, 0);
  assert.equal(result.finalPaperState.orders.length, 0);
  assert.equal(result.finalPaperState.position.quantity, 0);
});

test("backtest risk rejection is logged at the next observation without mutating Paper account", () => {
  const result = runBacktest(
    [{ timestamp: 1, close: 100 }, { timestamp: 2, close: 101 }],
    () => new AlwaysBuyStrategy(),
    { initialCash: 1_000, feeRate: 0, orderQuantity: 1, riskPolicy: { maxOrderNotional: 50 } }
  );

  assert.equal(result.metrics.fillCount, 0);
  assert.equal(result.metrics.rejectionCount, 1);
  assert.equal(result.metrics.finalEquity, 1_000);
  assert.equal(result.finalPaperState.orders.length, 0);
  assert.equal(result.decisions[0].signalTimestamp, 1);
  assert.equal(result.decisions[0].executionTimestamp, 2);
  assert.equal(result.decisions[0].executionMarketPrice, 101);
  assert.match(result.decisions[0].rejectionReason, /max order notional exceeded/);
  assert.equal(result.decisions[1].outcome, "UNFILLED");
  assert.equal(result.decisions[1].unfilledReason, "NO_NEXT_OBSERVATION");
});

test("backtest fails closed for empty, invalid, time-reversed, or impossible cost inputs", () => {
  assert.throws(() => runBacktest([], () => new AlwaysBuyStrategy()), /at least one point/);
  assert.throws(
    () => runBacktest([{ timestamp: 1, close: 100 }, { timestamp: 1, close: 101 }], () => new AlwaysBuyStrategy()),
    /strictly increasing/
  );
  assert.throws(
    () => runBacktest([{ timestamp: 1, close: 0 }], () => new AlwaysBuyStrategy()),
    /close must be positive/
  );
  assert.throws(
    () => runBacktest([{ timestamp: 1, close: 100 }], () => new AlwaysBuyStrategy(), { executionCosts: { spreadBps: -1 } }),
    /spreadBps/
  );
  assert.throws(
    () => runBacktest([{ timestamp: 1, close: 100 }], () => new AlwaysBuyStrategy(), { executionCosts: { spreadBps: 9_000, slippageBps: 6_000 } }),
    /non-positive sell price/
  );
});
