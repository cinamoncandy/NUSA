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

test("backtest reuses Paper accounting and records replayable causal decisions", () => {
  const config = { initialCash: 1_000, feeRate: 0.01, orderQuantity: 1 };
  const first = runBacktest(points, () => new BuyHoldSellStrategy(), config);
  const replay = runBacktest(points, () => new BuyHoldSellStrategy(), config);

  assert.deepEqual(replay, first);
  assert.deepEqual(first.decisions.map((decision) => decision.outcome), ["HOLD", "FILLED", "HOLD"]);
  assert.deepEqual(first.decisions.map((decision) => decision.signal.type), ["HOLD", "BUY", "HOLD"]);
  assert.equal(first.decisions[0].signal.reason, "awaiting-prior-observation");
  assert.equal(first.decisions[1].timestamp, points[1].timestamp);
  assert.equal(first.decisions[1].order.timestamp, new Date(points[1].timestamp).toISOString());
  assert.equal(first.decisions[1].executionPrice, points[1].close);
  assert.equal(first.finalPaperState.orders.length, 1);
  assert.equal(first.finalPaperState.position.quantity, 1);
  assert.equal(first.metrics.fillCount, 1);
  assert.equal(first.metrics.rejectionCount, 0);
  assert.equal(first.metrics.turnover, 0.12);
  assert.equal(first.metrics.spreadCost, 0);
  assert.equal(first.metrics.slippageCost, 0);
  assert.equal(first.metrics.totalTradingCost, first.metrics.feesPaid);
  assert.ok(Math.abs(first.metrics.finalEquity - 988.8) < 1e-9);
  assert.ok(Math.abs(first.metrics.totalReturn - (-0.0112)) < 1e-12);
  assert.ok(first.metrics.maxDrawdown > 0);
  assert.ok(first.metrics.benchmarkReturn > first.metrics.totalReturn);
  assert.equal(first.metrics.excessReturn, first.metrics.totalReturn - first.metrics.benchmarkReturn);
});

test("spread and slippage worsen next-observation fills and are reported separately from fees", () => {
  const result = runBacktest(points, () => new BuyHoldSellStrategy(), {
    initialCash: 1_000,
    feeRate: 0.01,
    orderQuantity: 1,
    executionCosts: { spreadBps: 20, slippageBps: 30 }
  });

  assert.equal(result.decisions[0].executionPrice, undefined);
  assert.ok(Math.abs(result.decisions[1].executionPrice - 120.48) < 1e-12);
  assert.equal(result.decisions[2].executionPrice, undefined);
  assert.ok(Math.abs(result.metrics.finalEquity - 988.3152) < 1e-9);
  assert.ok(Math.abs(result.metrics.turnover - 0.12048) < 1e-12);
  assert.ok(Math.abs(result.metrics.feesPaid - 1.2048) < 1e-12);
  assert.ok(Math.abs(result.metrics.spreadCost - 0.12) < 1e-12);
  assert.ok(Math.abs(result.metrics.slippageCost - 0.36) < 1e-12);
  assert.ok(Math.abs(result.metrics.totalTradingCost - 1.6848) < 1e-12);
  assert.ok(result.metrics.totalReturn < -0.0112);
});

test("backtest risk rejection is logged only when a prior signal reaches its execution observation", () => {
  const result = runBacktest(
    [{ timestamp: 1, close: 100 }, { timestamp: 2, close: 101 }],
    () => new AlwaysBuyStrategy(),
    { initialCash: 1_000, feeRate: 0, orderQuantity: 1, riskPolicy: { maxOrderNotional: 50 } }
  );

  assert.equal(result.metrics.fillCount, 0);
  assert.equal(result.metrics.rejectionCount, 1);
  assert.equal(result.metrics.finalEquity, 1_000);
  assert.equal(result.finalPaperState.orders.length, 0);
  assert.equal(result.decisions.length, 2);
  assert.equal(result.decisions[0].outcome, "HOLD");
  assert.equal(result.decisions[1].outcome, "REJECTED");
  assert.equal(result.decisions[1].timestamp, 2);
  assert.match(result.decisions[1].rejectionReason, /max order notional exceeded/);
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
