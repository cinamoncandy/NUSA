const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperBroker } = require("../dist/apps/cloud/src/paperBroker.js");
const { createOperationalPaperRiskGate } = require("../dist/apps/cloud/src/paperOperationalPreflight.js");
const { createSessionPeakEquityTracker } = require("../dist/apps/cloud/src/paperRiskState.js");
const { appendP0AlertEvent } = require("../dist/apps/cloud/src/p0AlertLedger.js");
const { readPaperEngineControlState } = require("../dist/apps/cloud/src/paperEngineControlState.js");

const pass = () => ({ status: "PASS", method: "test", evidence: [], blockers: [] });
const limits = {
  maxOrderNotional: 1_000,
  maxPositionNotional: 1_000,
  maxOpenOrders: 1,
  maxOrdersPerSecond: 10,
  maxOrdersPerMinute: 100,
  maxSameSideStreak: 10,
  maxSymbolExposureNotional: 1_000,
  maxPortfolioExposureNotional: 1_000,
  maxDailyBuyNotional: 1_000,
  maxDailySellNotional: 1_000,
  maxDailyLoss: 1_000,
  maxConsecutiveLosses: 3,
  maxSessionDrawdownRatio: 0.2,
  maxPriceDeviationRatio: 0.05
};

function gateFor(p0Records) {
  const broker = new PaperBroker(1_000, "KRW-BTC", 0);
  return createOperationalPaperRiskGate({
    getState: () => ({ deployment: pass(), reconciliation: pass(), riskGate: pass() }),
    getBroker: () => broker,
    getMarket: () => ({ symbol: "KRW-BTC", price: 100, status: "HEALTHY" }),
    getControl: () => readPaperEngineControlState([], p0Records),
    identity: {
      strategyFingerprint: "s",
      configFingerprint: "c",
      runtimeFingerprint: "r",
      riskPolicyFingerprint: "p",
      seenSignalIds: new Set(),
      seenCommandIds: new Set(),
      seenClientOrderIds: new Set()
    },
    limits,
    fingerprints: { strategy: "s", config: "c", runtime: "r", riskPolicy: "p" },
    sourceCommitSha: "a".repeat(40),
    sessionPeakEquity: createSessionPeakEquityTracker(1_000)
  });
}

test("open cloud P0 incident reaches the operational Risk Governor as HALT", () => {
  const p0Records = appendP0AlertEvent([], {
    eventId: "event-1",
    incidentId: "incident-1",
    type: "OPENED",
    occurredAt: 100,
    reason: "critical runtime invariant"
  });
  const result = gateFor(p0Records).evaluate({ path: "SHADOW", side: "BUY", quantity: 1, price: 100 });
  assert.equal(result.status, "HALT");
  assert.ok(result.reasonCodes.includes("OPEN_P0_ALERT"));
});

test("resolved cloud P0 incident no longer injects OPEN_P0_ALERT", () => {
  let p0Records = appendP0AlertEvent([], {
    eventId: "event-1",
    incidentId: "incident-1",
    type: "OPENED",
    occurredAt: 100,
    reason: "critical runtime invariant"
  });
  p0Records = appendP0AlertEvent(p0Records, {
    eventId: "event-2",
    incidentId: "incident-1",
    type: "RESOLVED",
    occurredAt: 101,
    reason: "operator verified recovery"
  });
  const result = gateFor(p0Records).evaluate({ path: "SHADOW", side: "BUY", quantity: 1, price: 100 });
  assert.equal(result.reasonCodes.includes("OPEN_P0_ALERT"), false);
});
