"use strict";
/**
 * Shared healthy baseline for the WO-0032 risk gateway tests. Every field is set so that
 * an unmodified request is ALLOW; each test perturbs exactly one thing, so a reason code
 * that appears can only have come from the change under test.
 */

const identity = Object.freeze({
  strategyFingerprint: "s",
  configFingerprint: "c",
  runtimeFingerprint: "r",
  riskPolicyFingerprint: "p",
  seenSignalIds: new Set(),
  seenCommandIds: new Set(),
  seenClientOrderIds: new Set()
});

const limits = Object.freeze({
  maxOrderNotional: 50,
  maxPositionNotional: 50,
  maxOpenOrders: 1,
  maxOrdersPerSecond: 3,
  maxOrdersPerMinute: 30,
  maxSameSideStreak: 5,
  maxSymbolExposureNotional: 500,
  maxPortfolioExposureNotional: 1000,
  maxDailyBuyNotional: 500,
  maxDailySellNotional: 500,
  maxDailyLoss: 50,
  maxConsecutiveLosses: 5,
  maxSessionDrawdownRatio: 0.2,
  maxPriceDeviationRatio: 0.05
});

const request = () => ({
  schemaVersion: 1,
  requestId: "r",
  signalId: "s1",
  commandId: "c1",
  clientOrderId: "o1",
  strategyFingerprint: "s",
  configFingerprint: "c",
  runtimeFingerprint: "r",
  riskPolicyFingerprint: "p",
  symbol: "KRW-BTC",
  side: "BUY",
  quantity: 1,
  referencePrice: 10,
  requestedAt: 10,
  marketDataState: { status: "HEALTHY", price: 10 },
  accountState: { cash: 100, positionQuantity: 0, openOrderCount: 0 },
  controlState: { killSwitchActive: false, liveCapabilityDetected: false, privateApiCapabilityDetected: false },
  approvalState: { approved: true, expiresAt: 20, symbols: ["KRW-BTC"] },
  persistenceState: { healthy: true },
  reconciliationState: { healthy: true, openP0: false },
  deploymentState: { integrityVerified: true },
  rateState: { ordersInLastSecond: 0, ordersInLastMinute: 0, sameSideStreak: 0 },
  exposureState: { symbolExposureNotional: 0, portfolioExposureNotional: 0, dailyBuyNotional: 0, dailySellNotional: 0 },
  sessionState: { dailyRealizedPnL: 0, consecutiveLossCount: 0, sessionPeakEquity: 100, sessionEquity: 100 }
});

const descriptor = () => ({
  schemaVersion: 1,
  deploymentId: "d1",
  sourceCommitSha: "abc123",
  expectedSourceCommitSha: "abc123",
  artifactSha256: "hash",
  expectedArtifactSha256: "hash",
  persistenceSchemaVersion: 1,
  expectedPersistenceSchemaVersion: 1,
  liveTradingCapabilityPresent: false,
  privateApiCapabilityPresent: false,
  credentialStoragePresent: false,
  killSwitchReachable: true,
  autoTradeDefaultEnabled: false,
  riskGatewayPresent: true
});

module.exports = { identity, limits, request, descriptor };
