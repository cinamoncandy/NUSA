const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperTradingExecutionLoop } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");
const { evaluatePreTradeRisk } = require("../dist/apps/cloud/src/independentRiskGateway.js");

// Proves independentRiskGateway.ts's evaluatePreTradeRisk() actually sits in front of
// PaperTradingExecutionLoop's automated STRATEGY fills now -- not just that the wiring
// compiles, but that a request which the gateway would reject actually blocks the order and
// leaves the account untouched.

const market = "KRW-BTC";
const identity = Object.freeze({
  strategyFingerprint: "s", configFingerprint: "c", runtimeFingerprint: "r", riskPolicyFingerprint: "p",
  seenSignalIds: new Set(), seenCommandIds: new Set(), seenClientOrderIds: new Set()
});
const fingerprints = Object.freeze({ strategy: "s", config: "c", runtime: "r", riskPolicy: "p" });

function buyTick(overrides = {}) {
  return {
    now: 1_000,
    market,
    price: 100,
    observedAt: 1_000,
    mode: "PAPER",
    killSwitchActive: false,
    tradingAllowed: true,
    overallHealth: "HEALTHY",
    decisions: [{
      symbol: market, action: "BUY", confidence: 1, risk: "LOW", allocation: 0.9,
      leverage: 1, score: 0.8, reasons: ["test"], decidedAt: 1_000
    }],
    ...overrides
  };
}

test("a decision within every limit is ALLOWed and fills normally", () => {
  const limits = {
    maxOrderNotional: 1_000_000, maxPositionNotional: 1_000_000, maxOpenOrders: 20,
    maxOrdersPerSecond: 5, maxOrdersPerMinute: 60, maxSameSideStreak: 10,
    maxSymbolExposureNotional: 1_000_000, maxPortfolioExposureNotional: 1_000_000,
    maxDailyBuyNotional: 1_000_000, maxDailySellNotional: 1_000_000,
    maxDailyLoss: 1_000_000, maxConsecutiveLosses: 5, maxSessionDrawdownRatio: 0.5,
    maxPriceDeviationRatio: 0.5
  };
  const loop = new PaperTradingExecutionLoop({
    initialCapital: 1_000,
    riskGate: { fingerprints, evaluate: (request) => evaluatePreTradeRisk(request, identity, limits) }
  });
  const result = loop.processTick(buyTick());
  assert.equal(result.status, "FILLED");
  assert.equal(result.orders.length, 1);
});

test("a decision that exceeds maxOrderNotional is BLOCKED by the risk gate, not filled", () => {
  const limits = {
    maxOrderNotional: 1, // any real order notional exceeds this
    maxPositionNotional: 1_000_000, maxOpenOrders: 20,
    maxOrdersPerSecond: 5, maxOrdersPerMinute: 60, maxSameSideStreak: 10,
    maxSymbolExposureNotional: 1_000_000, maxPortfolioExposureNotional: 1_000_000,
    maxDailyBuyNotional: 1_000_000, maxDailySellNotional: 1_000_000,
    maxDailyLoss: 1_000_000, maxConsecutiveLosses: 5, maxSessionDrawdownRatio: 0.5,
    maxPriceDeviationRatio: 0.5
  };
  const loop = new PaperTradingExecutionLoop({
    initialCapital: 1_000,
    riskGate: { fingerprints, evaluate: (request) => evaluatePreTradeRisk(request, identity, limits) }
  });
  const before = loop.snapshot();
  const result = loop.processTick(buyTick());

  assert.equal(result.status, "REJECTED");
  assert.match(result.reason, /MAX_ORDER_NOTIONAL/);
  assert.equal(result.orders.length, 0);
  const after = loop.snapshot();
  assert.deepEqual(after, before, "a blocked decision must leave the account state completely untouched");
});

test("KILL_SWITCH_ACTIVE from the risk gate HALTs (status BLOCKED), distinct from an ordinary REJECT", () => {
  const limits = {
    maxOrderNotional: 1_000_000, maxPositionNotional: 1_000_000, maxOpenOrders: 20,
    maxOrdersPerSecond: 5, maxOrdersPerMinute: 60, maxSameSideStreak: 10,
    maxSymbolExposureNotional: 1_000_000, maxPortfolioExposureNotional: 1_000_000,
    maxDailyBuyNotional: 1_000_000, maxDailySellNotional: 1_000_000,
    maxDailyLoss: 1_000_000, maxConsecutiveLosses: 5, maxSessionDrawdownRatio: 0.5,
    maxPriceDeviationRatio: 0.5
  };
  // The loop's own killSwitchActive tick field already blocks earlier, so this drives the
  // gateway's copy of the signal through controlState instead, proving the *gateway's* HALT
  // path (not just the loop's pre-existing coarse gate) is reachable and distinct.
  const haltingGate = {
    fingerprints,
    evaluate: (request) => evaluatePreTradeRisk({ ...request, controlState: { ...request.controlState, killSwitchActive: true } }, identity, limits)
  };
  const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000, riskGate: haltingGate });
  const result = loop.processTick(buyTick());
  assert.equal(result.status, "BLOCKED");
  assert.match(result.reason, /KILL_SWITCH_ACTIVE/);
});

test("without a riskGate configured, the loop behaves exactly as before (no regression for existing callers)", () => {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000 });
  const result = loop.processTick(buyTick());
  assert.equal(result.status, "FILLED");
});

test("a rejected decision does not consume the idempotency key -- retrying after raising the limit succeeds", () => {
  const strictLimits = {
    maxOrderNotional: 1, maxPositionNotional: 1_000_000, maxOpenOrders: 20,
    maxOrdersPerSecond: 5, maxOrdersPerMinute: 60, maxSameSideStreak: 10,
    maxSymbolExposureNotional: 1_000_000, maxPortfolioExposureNotional: 1_000_000,
    maxDailyBuyNotional: 1_000_000, maxDailySellNotional: 1_000_000,
    maxDailyLoss: 1_000_000, maxConsecutiveLosses: 5, maxSessionDrawdownRatio: 0.5,
    maxPriceDeviationRatio: 0.5
  };
  let limits = strictLimits;
  const loop = new PaperTradingExecutionLoop({
    initialCapital: 1_000,
    riskGate: { fingerprints, evaluate: (request) => evaluatePreTradeRisk(request, identity, limits) }
  });
  const blocked = loop.processTick(buyTick());
  assert.equal(blocked.status, "REJECTED");

  limits = { ...strictLimits, maxOrderNotional: 1_000_000 };
  const retried = loop.processTick(buyTick());
  assert.equal(retried.status, "FILLED");
});
