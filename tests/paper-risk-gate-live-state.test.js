const test = require("node:test");
const assert = require("node:assert/strict");
const { createOperationalPaperRiskGate } = require("../dist/apps/desktop/src/paper/paperOperationalPreflight.js");
const { createSessionPeakEquityTracker } = require("../dist/apps/desktop/src/paper/paperRiskState.js");
const { PaperBroker } = require("../dist/apps/desktop/src/paper/paperBroker.js");

/**
 * createOperationalPaperRiskGate used to build the PreTradeRiskRequest with
 * rateState/exposureState.dailyBuyNotional/dailySellNotional/sessionState.consecutiveLossCount
 * all hardcoded to 0, and sessionPeakEquity set to the SAME value as sessionEquity on every
 * call. evaluatePreTradeRisk's circuit breakers are otherwise correctly implemented, but a
 * check fed a compile-time constant instead of real history can never fire regardless of
 * what the account actually did. These tests hammer a real PaperBroker and confirm the
 * corresponding limits are now reachable.
 */

const state = Object.freeze({
  deployment: { status: "PASS", method: "test", evidence: [], blockers: [] },
  reconciliation: { status: "PASS", method: "test", evidence: [], blockers: [] },
  riskGate: { status: "PASS", method: "test", evidence: [], blockers: [] }
});

function baseIdentity() {
  return { strategyFingerprint: "s", configFingerprint: "c", runtimeFingerprint: "r", riskPolicyFingerprint: "p", seenSignalIds: new Set(), seenCommandIds: new Set(), seenClientOrderIds: new Set() };
}

function baseLimits(overrides = {}) {
  return {
    maxOrderNotional: 1_000_000, maxPositionNotional: 1_000_000, maxOpenOrders: 1_000,
    maxOrdersPerSecond: 1_000, maxOrdersPerMinute: 1_000, maxSameSideStreak: 1_000,
    maxSymbolExposureNotional: 1_000_000, maxPortfolioExposureNotional: 1_000_000,
    maxDailyBuyNotional: 1_000_000, maxDailySellNotional: 1_000_000,
    maxDailyLoss: 1_000_000, maxConsecutiveLosses: 1_000, maxSessionDrawdownRatio: 1,
    maxPriceDeviationRatio: 1,
    ...overrides
  };
}

function makeGate(broker, limits, peakEquity = 1_000_000) {
  return createOperationalPaperRiskGate({
    getState: () => state,
    getBroker: () => broker,
    getMarket: () => ({ symbol: "KRW-BTC", price: 100, status: "HEALTHY" }),
    getControl: () => ({ killSwitchActive: false, openP0: false }),
    identity: baseIdentity(),
    limits,
    fingerprints: { strategy: "s", config: "c", runtime: "r", riskPolicy: "p" },
    sourceCommitSha: "a".repeat(40),
    sessionPeakEquity: createSessionPeakEquityTracker(peakEquity)
  });
}

test("SAME_SIDE_BURST_LIMIT fires once real fill history shows an unbroken same-side streak", () => {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0);
  const now = new Date();
  for (let i = 0; i < 3; i += 1) broker.execute("BUY", 1, 100, now);
  const gate = makeGate(broker, baseLimits({ maxSameSideStreak: 3 }));
  const result = gate.evaluate({ path: "MANUAL", side: "BUY", quantity: 1, price: 100 });
  assert.ok(result.reasonCodes.includes("SAME_SIDE_BURST_LIMIT"), `expected SAME_SIDE_BURST_LIMIT, got ${result.reasonCodes.join(",")}`);
});

test("ORDER_RATE_LIMIT_PER_MINUTE fires once real fill history shows enough fills in the last minute", () => {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0);
  const now = new Date();
  for (let i = 0; i < 5; i += 1) broker.execute(i % 2 === 0 ? "BUY" : "SELL", 1, 100, now);
  const gate = makeGate(broker, baseLimits({ maxOrdersPerMinute: 5, maxSameSideStreak: 1_000 }));
  const result = gate.evaluate({ path: "MANUAL", side: "BUY", quantity: 1, price: 100 });
  assert.ok(result.reasonCodes.includes("ORDER_RATE_LIMIT_PER_MINUTE"), `expected ORDER_RATE_LIMIT_PER_MINUTE, got ${result.reasonCodes.join(",")}`);
});

test("MAX_DAILY_BUY_NOTIONAL fires once today's real BUY fills exceed the daily cap", () => {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0);
  const now = new Date();
  broker.execute("BUY", 4, 100, now); // 400 notional filled today
  const gate = makeGate(broker, baseLimits({ maxDailyBuyNotional: 450 }));
  const result = gate.evaluate({ path: "MANUAL", side: "BUY", quantity: 1, price: 100 }); // +100 => 500 > 450
  assert.ok(result.reasonCodes.includes("MAX_DAILY_BUY_NOTIONAL"), `expected MAX_DAILY_BUY_NOTIONAL, got ${result.reasonCodes.join(",")}`);
});

test("CONSECUTIVE_LOSS_LIMIT fires once real closes show an unbroken run of losing trades", () => {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0);
  const now = new Date();
  // Two losing round-trips: buy high, sell low.
  broker.execute("BUY", 1, 200, now);
  broker.execute("SELL", 1, 100, now); // loss
  broker.execute("BUY", 1, 200, now);
  broker.execute("SELL", 1, 100, now); // loss, streak = 2
  const gate = makeGate(broker, baseLimits({ maxConsecutiveLosses: 2 }));
  const result = gate.evaluate({ path: "MANUAL", side: "BUY", quantity: 1, price: 100 });
  assert.ok(result.reasonCodes.includes("CONSECUTIVE_LOSS_LIMIT"), `expected CONSECUTIVE_LOSS_LIMIT, got ${result.reasonCodes.join(",")}`);
});

test("a winning close resets the consecutive-loss streak", () => {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0);
  const now = new Date();
  broker.execute("BUY", 1, 200, now);
  broker.execute("SELL", 1, 100, now); // loss
  broker.execute("BUY", 1, 100, now);
  broker.execute("SELL", 1, 200, now); // win, resets streak to 0
  const gate = makeGate(broker, baseLimits({ maxConsecutiveLosses: 1 }));
  const result = gate.evaluate({ path: "MANUAL", side: "BUY", quantity: 1, price: 100 });
  assert.ok(!result.reasonCodes.includes("CONSECUTIVE_LOSS_LIMIT"), `did not expect CONSECUTIVE_LOSS_LIMIT, got ${result.reasonCodes.join(",")}`);
});

test("SESSION_DRAWDOWN_LIMIT fires once equity falls below a real previously observed peak", () => {
  const broker = new PaperBroker(10_000, "KRW-BTC", 0);
  const now = new Date();
  broker.execute("BUY", 10, 100, now); // cash 9000, position 10 @ avg 100
  const gate = makeGate(broker, baseLimits({ maxSessionDrawdownRatio: 0.1 }), 0);
  const first = gate.evaluate({ path: "MANUAL", side: "BUY", quantity: 0.0000001, price: 200 }); // equity 11000, sets peak
  assert.equal(first.reasonCodes.includes("SESSION_DRAWDOWN_LIMIT"), false);
  const second = gate.evaluate({ path: "MANUAL", side: "BUY", quantity: 1, price: 50 }); // equity 9500, drawdown ~13.6%
  assert.ok(second.reasonCodes.includes("SESSION_DRAWDOWN_LIMIT"), `expected SESSION_DRAWDOWN_LIMIT, got ${second.reasonCodes.join(",")}`);
});
