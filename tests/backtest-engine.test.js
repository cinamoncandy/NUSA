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

const points = [
  { timestamp: Date.parse("2026-01-01T00:00:00Z"), close: 100 },
  { timestamp: Date.parse("2026-01-01T00:01:00Z"), close: 120 },
  { timestamp: Date.parse("2026-01-01T00:02:00Z"), close: 110 }
];

test("backtest reuses Paper accounting and records replayable decisions", () => {
  const config = { initialCash: 1_000, feeRate: 0.01, orderQuantity: 1 };
  const first = runBacktest(points, () => new BuyHoldSellStrategy(), config);
  const replay = runBacktest(points, () => new BuyHoldSellStrategy(), config);

  assert.deepEqual(replay, first);
  assert.deepEqual(first.decisions.map((decision) => decision.outcome), ["FILLED", "HOLD", "FILLED"]);
  assert.deepEqual(first.decisions.map((decision) => decision.signal.type), ["BUY", "HOLD", "SELL"]);
  assert.equal(first.finalPaperState.orders.length, 2);
  assert.equal(first.finalPaperState.position.quantity, 0);
  assert.equal(first.metrics.fillCount, 2);
  assert.equal(first.metrics.rejectionCount, 0);
  assert.equal(first.metrics.turnover, 0.21);
  assert.equal(first.metrics.spreadCost, 0);
  assert.equal(first.metrics.slippageCost, 0);
  assert.equal(first.metrics.totalTradingCost, first.metrics.feesPaid);
  assert.ok(Math.abs(first.metrics.finalEquity - 1007.9) < 1e-9);
  assert.ok(Math.abs(first.metrics.totalReturn - 0.0079) < 1e-12);
  assert.ok(first.metrics.maxDrawdown > 0);
  assert.ok(first.metrics.benchmarkReturn > first.metrics.totalReturn);
  assert.equal(first.metrics.excessReturn, first.metrics.totalReturn - first.metrics.benchmarkReturn);
});

test("spread and slippage worsen fills and are reported separately from fees", () => {
  const result = runBacktest(points, () => new BuyHoldSellStrategy(), {
    initialCash: 1_000,
    feeRate: 0.01,
    orderQuantity: 1,
    executionCosts: { spreadBps: 20, slippageBps: 30 }
  });

  assert.ok(Math.abs(result.decisions[0].executionPrice - 100.4) < 1e-12);
  assert.ok(Math.abs(result.decisions[2].executionPrice - 109.56) < 1e-12);
  assert.ok(Math.abs(result.metrics.finalEquity - 1007.0604) < 1e-9);
  assert.ok(Math.abs(result.metrics.turnover - 0.20996) < 1e-12);
  assert.ok(Math.abs(result.metrics.feesPaid - 2.0996) < 1e-12);
  assert.ok(Math.abs(result.metrics.spreadCost - 0.21) < 1e-12);
  assert.ok(Math.abs(result.metrics.slippageCost - 0.63) < 1e-12);
  assert.ok(Math.abs(result.metrics.totalTradingCost - 2.9396) < 1e-12);
  assert.ok(result.metrics.totalReturn < 0.0079);
});

test("backtest risk rejection is logged without mutating Paper account", () => {
  const result = runBacktest(
    [{ timestamp: 1, close: 100 }, { timestamp: 2, close: 101 }],
    () => new AlwaysBuyStrategy(),
    { initialCash: 1_000, feeRate: 0, orderQuantity: 1, riskPolicy: { maxOrderNotional: 50 } }
  );

  assert.equal(result.metrics.fillCount, 0);
  assert.equal(result.metrics.rejectionCount, 2);
  assert.equal(result.metrics.finalEquity, 1_000);
  assert.equal(result.finalPaperState.orders.length, 0);
  assert.match(result.decisions[0].rejectionReason, /max order notional exceeded/);
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
