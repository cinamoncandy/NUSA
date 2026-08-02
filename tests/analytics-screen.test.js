const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAnalyticsScreen } = require("../dist/apps/mobile/src/analyticsScreen.js");

const trade = (id, netPnl, overrides = {}) => ({ id, netPnl, fees: 1, slippage: 0.1, side: "BUY", direction: "LONG", positionSize: 100, holdingTimeMs: 3_600_000, rMultiple: netPnl / 10, timestamp: Number(id), strategyId: "sma", regime: "UPTREND", ...overrides });
const input = (overrides = {}) => ({ generatedAt: 10_000, period: "30D", initialEquity: 100, equityCurve: [{ timestamp: 0, equity: 100 }, { timestamp: 86_400_000, equity: 110 }, { timestamp: 172_800_000, equity: 105 }], trades: [trade("1", 10), trade("2", -5, { side: "SELL", regime: "SIDEWAYS" })], strategies: [{ id: "sma", netProfit: 5, drawdown: 0.1, winRate: 0.5, profitFactor: 2, consistency: 0.8, confidence: 0.7 }], regimes: [{ name: "UPTREND", trades: [trade("1", 10)] }, { name: "SIDEWAYS", trades: [trade("2", -5)] }], portfolioScore: 80, ...overrides });

test("analytics projection provides metrics, curves, distributions and data-backed insights", () => {
  const result = buildAnalyticsScreen(input());
  assert.equal(result.netProfit, 5);
  assert.ok(Math.abs(result.totalReturn - 0.05) < Number.EPSILON);
  assert.equal(result.winRate, 0.5);
  assert.equal(result.profitFactor, 2);
  assert.equal(result.drawdownCurve.at(-1).drawdown, 5 / 110);
  assert.equal(result.regimeAnalysis[0].name, "UPTREND");
  assert.equal(result.bestRegime, "UPTREND");
  assert.ok(result.insights.every((insight) => insight.source.startsWith("source:")));
  assert.match(result.export.csv, /netProfit,5/);
  assert.doesNotThrow(() => JSON.parse(result.export.json));
});

test("analytics projection preserves unavailable metrics and rejects invalid data", () => {
  const empty = buildAnalyticsScreen(input({ trades: [], equityCurve: [], regimes: [] }));
  assert.equal(empty.totalReturn, null);
  assert.equal(empty.profitFactor, null);
  assert.equal(empty.expectancy, null);
  assert.throws(() => buildAnalyticsScreen(input({ portfolioScore: 101 })), /portfolioScore/);
  assert.throws(() => buildAnalyticsScreen(input({ trades: [trade("1", Number.NaN)] })), /trade.netPnl/);
});
