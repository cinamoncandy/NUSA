const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluatePreTradeRisk } = require("../dist/apps/desktop/src/risk/independentRiskGateway.js");
const { RUNTIME_EXCHANGE_CAPABILITIES } = require("../dist/apps/desktop/src/exchange/runtimeExchangeCapabilities.js");

const IDENTITY = { strategyFingerprint: "s", configFingerprint: "c", runtimeFingerprint: "r", riskPolicyFingerprint: "p", seenSignalIds: new Set(), seenCommandIds: new Set(), seenClientOrderIds: new Set() };
const LIMITS = { maxOrderNotional: 1e9, maxPositionNotional: 1e9, maxOpenOrders: 10, maxOrdersPerSecond: 10, maxOrdersPerMinute: 600, maxSameSideStreak: 100, maxSymbolExposureNotional: 1e9, maxPortfolioExposureNotional: 1e9, maxDailyBuyNotional: 1e9, maxDailySellNotional: 1e9, maxDailyLoss: 1e9, maxConsecutiveLosses: 100, maxSessionDrawdownRatio: 1, maxPriceDeviationRatio: 1 };

function request(controlOverrides) {
  const now = 1_700_000_000_000;
  return {
    schemaVersion: 1,
    requestId: `req:${Math.random()}`,
    signalId: `sig:${Math.random()}`,
    commandId: `cmd:${Math.random()}`,
    clientOrderId: `coid:${Math.random()}`,
    strategyFingerprint: "s", configFingerprint: "c", runtimeFingerprint: "r", riskPolicyFingerprint: "p",
    symbol: "KRW-BTC", side: "BUY", quantity: 0.001, referencePrice: 80_000_000, requestedAt: now,
    marketDataState: { status: "HEALTHY", price: 80_000_000 },
    accountState: { cash: 10_000_000, positionQuantity: 0, openOrderCount: 0 },
    controlState: { killSwitchActive: false, liveCapabilityDetected: false, privateApiCapabilityDetected: false, ...controlOverrides },
    approvalState: { approved: true, expiresAt: now + 60_000, symbols: ["KRW-BTC"] },
    persistenceState: { healthy: true },
    reconciliationState: { healthy: true, openP0: false },
    deploymentState: { integrityVerified: true },
    rateState: { ordersInLastSecond: 0, ordersInLastMinute: 0, sameSideStreak: 0 },
    exposureState: { symbolExposureNotional: 0, portfolioExposureNotional: 0, dailyBuyNotional: 0, dailySellNotional: 0 },
    sessionState: { dailyRealizedPnL: 0, consecutiveLossCount: 0, sessionPeakEquity: 10_000_000, sessionEquity: 10_000_000 }
  };
}

test("the declared runtime capabilities are all absent while the release boundary is paper-only", () => {
  assert.equal(RUNTIME_EXCHANGE_CAPABILITIES.liveTrading, false);
  assert.equal(RUNTIME_EXCHANGE_CAPABILITIES.authenticatedMutation, false);
  assert.equal(RUNTIME_EXCHANGE_CAPABILITIES.credentialStorage, false);
});

test("the risk gateway blocks a command when a live trading capability is reported", () => {
  // Regression: paperOperationalPreflight built this field as a literal `false`, which made the
  // gateway's LIVE_CAPABILITY_DETECTED block unreachable no matter what the build actually
  // contained. The block itself must work, so that wiring a real value to it means something.
  const decision = evaluatePreTradeRisk(request({ liveCapabilityDetected: true }), IDENTITY, LIMITS);
  assert.notEqual(decision.status, "ALLOW");
  assert.ok(decision.reasonCodes.includes("LIVE_CAPABILITY_DETECTED"), decision.reasonCodes.join(","));
});

test("the risk gateway blocks a command when a private API mutation capability is reported", () => {
  const decision = evaluatePreTradeRisk(request({ privateApiCapabilityDetected: true }), IDENTITY, LIMITS);
  assert.notEqual(decision.status, "ALLOW");
  assert.ok(decision.reasonCodes.includes("PRIVATE_API_CAPABILITY_DETECTED"), decision.reasonCodes.join(","));
});

test("an otherwise identical command is allowed when no prohibited capability is reported", () => {
  const decision = evaluatePreTradeRisk(request({}), IDENTITY, LIMITS);
  assert.ok(!decision.reasonCodes.includes("LIVE_CAPABILITY_DETECTED"));
  assert.ok(!decision.reasonCodes.includes("PRIVATE_API_CAPABILITY_DETECTED"));
});
