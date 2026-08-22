const test = require("node:test");
const assert = require("node:assert/strict");
const { calculatePositionQuantity, buildCapitalSnapshot, evaluateCapitalProtection } = require("../dist/apps/desktop/src/paper/positionSizing.js");

const base = { equity: 100_000, availableBuyingPower: 80_000, price: 100, riskLimits: { maxOrderNotional: 10_000, maxQuantity: 200 } };

test("position sizing supports configurable models and applies Risk caps", () => {
  const models = [
    { model: "FIXED_AMOUNT", fixedAmount: 5_000 },
    { model: "FIXED_PERCENTAGE", fixedPercentage: 0.1 },
    { model: "RISK_PERCENTAGE", riskPercentage: 0.01, stopDistance: 5 },
    { model: "VOLATILITY_ADJUSTED", fixedPercentage: 0.2, volatilityTarget: 0.1, volatility: 0.2 },
    { model: "ATR_BASED", riskPercentage: 0.01, atr: 5 },
    { model: "KELLY", winProbability: 0.6, rewardRiskRatio: 2, kellyFraction: 0.25 }
  ];
  for (const model of models) {
    const result = calculatePositionQuantity({ ...base, ...model });
    assert.ok(result.approvedQuantity >= 0);
    assert.ok(result.approvedNotional <= 10_000);
    assert.ok(result.approvedQuantity <= 200);
  }
  const lossLimited = calculatePositionQuantity({ ...base, model: "RISK_PERCENTAGE", riskPercentage: 0.5, stopDistance: 10, riskLimits: { maxLoss: 100 } });
  assert.ok(lossLimited.approvedNotional <= 1_000);
});

test("capital snapshot separates available and reserved buying power", () => {
  const snapshot = buildCapitalSnapshot({ cash: 80_000, reservedCapital: 20_000, marketValue: 25_000, peakEquity: 110_000, dailyStartEquity: 108_000, weeklyStartEquity: 100_000, monthlyStartEquity: 90_000, realizedPnl: -100, unrealizedPnl: 500 });
  assert.equal(snapshot.currentEquity, 105_000);
  assert.equal(snapshot.availableBuyingPower, 60_000);
  assert.equal(snapshot.dailyEquity, -3_000);
  assert.equal(snapshot.realizedPnl, -100);
});

test("capital protection reduces near limits and blocks breached limits", () => {
  const limits = { maximumDailyLoss: 10_000, maximumWeeklyLoss: 20_000, maximumDrawdown: 0.2, maximumConsecutiveLosses: 3, maximumRiskBudgetUsage: 0.8 };
  const snapshot = buildCapitalSnapshot({ cash: 92_000, reservedCapital: 0, marketValue: 0, peakEquity: 100_000, dailyStartEquity: 100_000, weeklyStartEquity: 100_000, monthlyStartEquity: 100_000, realizedPnl: 0, unrealizedPnl: 0 });
  const reduced = evaluateCapitalProtection({ snapshot, consecutiveLosses: 0, riskBudgetUsage: 0.6 }, limits);
  assert.equal(reduced.status, "REDUCE");
  assert.equal(reduced.positionSizeMultiplier, 0.5);
  const blocked = evaluateCapitalProtection({ snapshot, consecutiveLosses: 3, riskBudgetUsage: 0.6 }, limits);
  assert.equal(blocked.status, "BLOCK");
  assert.equal(blocked.blockNewEntries, true);
  assert.equal(blocked.pauseStrategy, true);
  assert.equal(blocked.requiresAcknowledgement, true);
});
