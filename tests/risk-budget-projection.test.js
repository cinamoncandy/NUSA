const test = require("node:test");
const assert = require("node:assert/strict");
const { projectRiskBudgetUsage } = require("../dist/apps/desktop/src/risk/riskBudgetProjection.js");

const request = (overrides = {}) => ({
  schemaVersion: 1, requestId: "r", signalId: "s", commandId: "c", clientOrderId: "o",
  strategyFingerprint: "a", configFingerprint: "b", runtimeFingerprint: "c", riskPolicyFingerprint: "d",
  symbol: "KRW-BTC", side: "BUY", quantity: 1, referencePrice: 100, requestedAt: 1,
  marketDataState: { status: "HEALTHY", price: 100 },
  accountState: { cash: 1_000, positionQuantity: 2, openOrderCount: 2 },
  controlState: { killSwitchActive: false, liveCapabilityDetected: false, privateApiCapabilityDetected: false },
  approvalState: { approved: true, expiresAt: 2, symbols: ["KRW-BTC"] },
  persistenceState: { healthy: true }, reconciliationState: { healthy: true, openP0: false },
  deploymentState: { integrityVerified: true },
  rateState: { ordersInLastSecond: 2, ordersInLastMinute: 5, sameSideStreak: 3 },
  exposureState: { symbolExposureNotional: 10, portfolioExposureNotional: 20, dailyBuyNotional: 30, dailySellNotional: 40 },
  sessionState: { dailyRealizedPnL: -50, consecutiveLossCount: 2, sessionPeakEquity: 1_000, sessionEquity: 900 },
  ...overrides
});

const limits = {
  maxOrderNotional: 100, maxPositionNotional: 100, maxOpenOrders: 4, maxOrdersPerSecond: 4,
  maxOrdersPerMinute: 10, maxSameSideStreak: 6, maxSymbolExposureNotional: 20,
  maxPortfolioExposureNotional: 40, maxDailyBuyNotional: 60, maxDailySellNotional: 80,
  maxDailyLoss: 100, maxConsecutiveLosses: 4, maxSessionDrawdownRatio: 0.2, maxPriceDeviationRatio: 0.1
};

test("projects all risk budget categories as bounded usage ratios", () => {
  assert.deepEqual(projectRiskBudgetUsage(request(), limits), {
    symbolExposure: 0.5, portfolioExposure: 0.5, dailyBuyNotional: 0.5, dailySellNotional: 0.5,
    openOrders: 0.5, ordersPerSecond: 0.5, ordersPerMinute: 0.5, sameSideStreak: 0.5,
    dailyLoss: 0.5, consecutiveLosses: 0.5, sessionDrawdown: 0.5
  });
});

test("zero limits are represented without NaN or Infinity", () => {
  const zero = Object.fromEntries(Object.keys(limits).map((key) => [key, 0]));
  const usage = projectRiskBudgetUsage(request(), zero);
  assert.equal(usage.symbolExposure, 1);
  assert.equal(usage.openOrders, 1);
  assert.equal(projectRiskBudgetUsage(request({ accountState: { cash: 1_000, positionQuantity: 2, openOrderCount: 0 }}), zero).openOrders, 0);
});
