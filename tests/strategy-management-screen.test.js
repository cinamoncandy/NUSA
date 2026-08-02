const test = require("node:test");
const assert = require("node:assert/strict");
const { buildStrategyManagementScreen } = require("../dist/apps/mobile/src/strategyManagementScreen.js");

const strategy = (id, totalPnl, overrides = {}) => ({ id, name: id.toUpperCase(), status: "RUNNING", market: "KRW-BTC", regime: "UPTREND", todaysPnl: totalPnl, totalPnl, winRate: 0.6, profitFactor: 1.5, drawdown: 0.05, confidence: 0.8, health: "HEALTHY", lastSignal: "BUY", lastTradeAt: 100, nextEvaluationAt: 200, runtimeStatus: "READY", websocketStatus: "CONNECTED", errorCount: 0, capitalUsage: 100, sharpeRatio: 1, recoveryFactor: 2, stability: 0.9, config: { positionSize: 10, riskPercent: 0.01, stopLoss: 0.02, takeProfit: 0.04, maxDailyLoss: 100, maxExposure: 500, tradingHours: ["09:00-18:00"], allowedRegimes: ["UPTREND"], allowedSymbols: ["KRW-BTC"] }, ...overrides });
const input = (overrides = {}) => ({ generatedAt: 1_000, strategies: [strategy("sma", 30), strategy("mean", -10, { status: "PAUSED", health: "ATTENTION", drawdown: 0.2 })], selectedStrategyId: "sma", selectedTab: "OVERVIEW", ...overrides });

test("strategy management projects health, comparison, controls and evidence-backed recommendations", () => {
  const result = buildStrategyManagementScreen(input());
  assert.equal(result.header.active, 1);
  assert.equal(result.header.paused, 1);
  assert.equal(result.header.totalProfit, 20);
  assert.equal(result.comparison[0].id, "sma");
  assert.equal(result.controls.pause, true);
  assert.equal(result.controls.stop, true);
  assert.equal(result.aiAssistant.best, "sma");
  assert.equal(result.aiAssistant.suggestedPause, "mean");
  assert.equal(result.aiAssistant.autoApply, false);
});

test("strategy management exposes empty state and rejects unsafe input", () => {
  const result = buildStrategyManagementScreen(input({ strategies: [], selectedStrategyId: null }));
  assert.deepEqual(result.emptyState, { create: true, import: true, templates: true, documentation: true });
  assert.throws(() => buildStrategyManagementScreen(input({ strategies: [strategy("sma", 1, { confidence: 2 })] })), /confidence/);
  assert.throws(() => buildStrategyManagementScreen(input({ selectedStrategyId: "missing" })), /unavailable/);
});
