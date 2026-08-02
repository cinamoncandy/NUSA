const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPortfolioScreen } = require("../dist/apps/mobile/src/portfolioScreen.js");

const input = (overrides = {}) => ({
  generatedAt: 100, totalEquity: 1000, totalPnl: 50, todaysPnl: 10, totalReturn: 0.05, healthScore: 92, health: "HEALTHY",
  allocation: { cash: { value: 500, dailyChange: 0 }, activePositions: { value: 400, dailyChange: 10 }, reservedCapital: { value: 100, dailyChange: 0 } },
  positions: [{ symbol: "KRW-BTC", direction: "LONG", quantity: 1, entryPrice: 90, currentPrice: 100, unrealizedPnl: 10, risk: "HEALTHY", holdingTimeMs: 60_000 }],
  performance: { "1D": [{ timestamp: 100, equity: 1000, pnl: 10 }] },
  risk: { exposure: 0.4, availableCapital: 500, riskBudgetUsed: 0.2, currentDrawdown: 0.01, maxDrawdown: 0.1, dailyLoss: 0, consecutiveLosses: 0, warnings: [] },
  strategies: [{ id: "sma", profit: 30, drawdown: 0.02, winRate: 0.6, contribution: 0.6, status: "RUNNING" }], rebalanceSupported: false, ...overrides
});

test("portfolio projection answers equity, performance, allocation, risk, and strategy ranking", () => {
  const result = buildPortfolioScreen(input());
  assert.equal(result.totalEquity, 1000);
  assert.equal(result.totalPnl, 50);
  assert.equal(result.allocation[0].percentage, 0.5);
  assert.equal(result.strategies[0].id, "sma");
  assert.equal(result.quickActions.closeAll, true);
  assert.equal(result.allocationSegments[1].name, "CRYPTO");
  assert.equal(result.positionActions[0].modifyTakeProfitStopLoss, true);
  assert.equal(result.aiInsights.bestPerformer, "sma");
  assert.equal(result.exports.pdf, false);
});

test("empty portfolio exposes cash and next action without fabricating positions", () => {
  const result = buildPortfolioScreen(input({ positions: [], allocation: { cash: { value: 1000, dailyChange: 0 }, activePositions: { value: 0, dailyChange: 0 }, reservedCapital: { value: 0, dailyChange: 0 } } }));
  assert.equal(result.emptyState.cash, 1000);
  assert.equal(result.quickActions.closeAll, false);
  assert.equal(result.positions.length, 0);
});

test("allocation mismatch and invalid health score fail closed", () => {
  assert.throws(() => buildPortfolioScreen(input({ allocation: { cash: { value: 900, dailyChange: 0 }, activePositions: { value: 400, dailyChange: 0 }, reservedCapital: { value: 100, dailyChange: 0 } } })), /reconcile/);
  assert.throws(() => buildPortfolioScreen(input({ healthScore: 101 })), /healthScore/);
});
