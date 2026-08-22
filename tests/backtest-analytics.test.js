const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeEquityCurve, calculateExposure, calculatePerformanceMetrics, matchTrades } = require("../dist/apps/desktop/src/strategy/backtestAnalytics.js");
const { runBacktest } = require("../dist/apps/desktop/src/strategy/backtestEngine.js");

const order = (id, side, quantity, price, fee, time) => ({ id, market: "KRW-BTC", side, quantity, price, fee, filledAt: new Date(time).toISOString() });

test("trade matcher calculates a single closed trade with fees and holding time", () => {
  const matched = matchTrades([order("buy", "BUY", 1, 100, 1, 1_000), order("sell", "SELL", 1, 120, 1, 4_000)]);
  assert.deepEqual(matched.trades, [{ entryTime: 1_000, exitTime: 4_000, entryPrice: 100, exitPrice: 120, quantity: 1, fees: 2, grossPnL: 20, netPnL: 18, holdingDuration: 3_000 }]);
  assert.deepEqual(matched.openPosition, { status: "FLAT", quantity: 0 });
});

test("trade matcher uses FIFO lots for multiple partial exits", () => {
  const matched = matchTrades([
    order("buy-1", "BUY", 1, 100, 1, 1_000),
    order("buy-2", "BUY", 1, 110, 1, 2_000),
    order("sell", "SELL", 1.5, 130, 1.5, 3_000)
  ]);
  assert.equal(matched.trades.length, 2);
  assert.deepEqual(matched.trades.map((trade) => trade.quantity), [1, 0.5]);
  assert.deepEqual(matched.trades.map((trade) => trade.entryPrice), [100, 110]);
  assert.equal(matched.openPosition.status, "OPEN_POSITION");
  assert.equal(matched.openPosition.quantity, 0.5);
  assert.equal(matched.openPosition.averageEntryPrice, 110);
});

test("performance metrics keep gross price PnL separate from net fee-aware outcomes", () => {
  const trades = [
    { entryTime: 1, exitTime: 2, entryPrice: 10, exitPrice: 13, quantity: 1, fees: 1, grossPnL: 3, netPnL: 2, holdingDuration: 1 },
    { entryTime: 3, exitTime: 5, entryPrice: 10, exitPrice: 8, quantity: 1, fees: 1, grossPnL: -2, netPnL: -3, holdingDuration: 2 }
  ];
  const metrics = calculatePerformanceMetrics(trades, 0.5);
  assert.deepEqual(metrics, { profitFactor: 2 / 3, expectancy: -0.5, averageWin: 2, averageLoss: 3, winRate: 0.5, lossRate: 0.5, payoffRatio: 2 / 3, averageHoldingTime: 1.5, exposure: 0.5, trades: 2, grossProfit: 3, grossLoss: 2, netWinningProfit: 2, netLosingLoss: 3, netProfit: -1 });
  const empty = calculatePerformanceMetrics([], 0);
  assert.equal(empty.trades, 0); assert.equal(empty.expectancy, undefined); assert.equal(empty.profitFactor, undefined);
});

test("equity analytics calculate drawdown, recovery, ulcer index, and export", () => {
  const analytics = analyzeEquityCurve([{ timestamp: 0, equity: 100 }, { timestamp: 10, equity: 80 }, { timestamp: 20, equity: 90 }, { timestamp: 30, equity: 110 }], 10);
  assert.equal(analytics.maximumDrawdown, 0.2);
  assert.equal(analytics.longestDrawdown, 20);
  assert.equal(analytics.recoveryFactor, 0.5);
  assert.ok(analytics.ulcerIndex > 0);
  assert.equal(analytics.equityCurveCsv, "timestamp,equity\n0,100\n10,80\n20,90\n30,110");
  assert.equal(calculateExposure([order("buy", "BUY", 1, 1, 0, 10), order("sell", "SELL", 1, 1, 0, 30)], 0, 40), 0.5);
});

class OpenBuyStrategy {
  constructor() { this.id = "open-buy"; this.name = "Open Buy"; this.index = 0; }
  onTick(tick) { this.index += 1; return { type: this.index === 1 ? "BUY" : "HOLD", reason: "test", confidence: 0, timestamp: tick.timestamp }; }
  reset() { this.index = 0; }
}

test("backtest reports open positions without forced liquidation and preserves cost-aware benchmark comparison", () => {
  const points = [{ timestamp: 1_000, close: 100 }, { timestamp: 2_000, close: 110 }];
  const base = runBacktest(points, () => new OpenBuyStrategy(), { initialCash: 1_000, feeRate: 0, orderQuantity: 1 });
  const costly = runBacktest(points, () => new OpenBuyStrategy(), { initialCash: 1_000, feeRate: 0, orderQuantity: 1, executionCosts: { spreadBps: 20, slippageBps: 30 } });
  assert.equal(base.openPosition.status, "OPEN_POSITION");
  assert.equal(base.trades.length, 0);
  assert.equal(base.performance.trades, 0);
  assert.equal(base.benchmark.outperformance, base.metrics.outperformance);
  assert.equal(base.benchmark.outperformance, base.metrics.excessReturn);
  assert.ok(costly.metrics.finalEquity < base.metrics.finalEquity);
  assert.ok(costly.benchmark.buyAndHoldReturn < base.benchmark.buyAndHoldReturn);
  assert.deepEqual(runBacktest(points, () => new OpenBuyStrategy(), { initialCash: 1_000, feeRate: 0, orderQuantity: 1 }), base);
});
