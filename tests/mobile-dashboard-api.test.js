const test = require("node:test");
const assert = require("node:assert/strict");
const { buildMobileDashboardResponse } = require("../dist/apps/cloud/src/mobileDashboardApi.js");
const { decodeMobileDashboardResponse } = require("../dist/apps/mobile/src/mobileDashboardSync.js");

const decision = Object.freeze({
  symbol: "BTCUSDT", action: "BUY", confidence: 0.8, risk: "LOW", allocation: 0.4,
  leverage: 2, score: 0.7, reasons: Object.freeze(["ETF: inflow"]), decidedAt: 100
});
const portfolio = Object.freeze({
  allocations: Object.freeze([Object.freeze({
    symbol: "BTCUSDT", instrument: "FUTURES", action: "BUY", capital: 400,
    share: 0.4, leverage: 2, confidence: 0.8, risk: "LOW"
  })]),
  deployedCapital: 400, cashCapital: 600, reservedCapital: 250,
  grossShare: 0.4, futuresShare: 0.4, decidedAt: 100
});
const intelligence = Object.freeze({ signals: Object.freeze([]), staleSources: Object.freeze(["NEWS"]), generatedAt: 100 });

const payload = () => buildMobileDashboardResponse({
  now: 100, mode: "PAPER", killSwitchActive: false, overallHealth: "HEALTHY",
  headline: "정상 운용 중입니다.", issues: [], portfolio, decisions: [decision], intelligence
});

test("assembles and decodes a versioned dashboard response", () => {
  const result = decodeMobileDashboardResponse(payload(), 100, 5000);
  assert.equal(result.apiVersion, "1");
  assert.equal(result.tradingAllowed, true);
  assert.equal(result.deployableCapital, 1000);
  assert.equal(result.futuresCapital, 400);
  assert.deepEqual(result.staleIntelligenceSources, ["NEWS"]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.positions), true);
});

test("fails closed for stale, future, or unsupported responses", () => {
  const value = payload();
  assert.throws(() => decodeMobileDashboardResponse(value, 6000, 100), /stale/);
  assert.throws(() => decodeMobileDashboardResponse({ ...value, generatedAt: 101 }, 100, 100), /generatedAt/);
  assert.throws(() => decodeMobileDashboardResponse({ ...value, apiVersion: "2" }, 100, 100), /unsupported/);
});

test("does not allow trading while unhealthy or kill-switched", () => {
  const unhealthy = buildMobileDashboardResponse({
    now: 100, mode: "PAPER", killSwitchActive: false, overallHealth: "DEGRADED",
    headline: "점검 중입니다.", issues: ["Market data: DEGRADED"], portfolio, decisions: [decision], intelligence
  });
  assert.equal(unhealthy.tradingAllowed, false);
  const stopped = buildMobileDashboardResponse({
    now: 100, mode: "PAPER", killSwitchActive: true, overallHealth: "DOWN",
    headline: "안전을 위해 중지했습니다.", issues: ["Kill switch active"], portfolio, decisions: [decision], intelligence
  });
  assert.equal(stopped.tradingAllowed, false);
});

test("rejects unreconciled capital and invalid leverage", () => {
  const value = payload();
  assert.throws(() => decodeMobileDashboardResponse({ ...value, deployableCapital: 999 }, 100, 100), /do not reconcile/);
  assert.throws(() => decodeMobileDashboardResponse({
    ...value,
    positions: [{ ...value.positions[0], leverage: 0 }]
  }, 100, 100), /leverage/);
});
