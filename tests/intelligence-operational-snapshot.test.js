const test = require("node:test");
const assert = require("node:assert/strict");
const { fuseMarketIntelligence } = require("../dist/apps/cloud/src/marketIntelligenceFusion.js");
const { buildOperationalSnapshot } = require("../dist/apps/mobile/src/operationalSnapshot.js");

const observation = (overrides = {}) => ({
  id: "obs-1",
  source: "NEWS",
  sentiment: 0.5,
  confidence: 0.8,
  observedAt: 100,
  expiresAt: 200,
  summary: "ETF inflow increased",
  ...overrides
});

test("fuses active observations deterministically and excludes stale data", () => {
  const result = fuseMarketIntelligence(150, [
    observation(),
    observation({ id: "obs-2", source: "NEWS", sentiment: -0.2, confidence: 0.4, summary: "Funding elevated" }),
    observation({ id: "obs-3", source: "MACRO", sentiment: 0.3, confidence: 0.9, summary: "Inflation cooled" }),
    observation({ id: "obs-4", source: "CHART", expiresAt: 120, summary: "Old breakout" })
  ]);
  assert.deepEqual(result.signals.map((signal) => signal.source), ["MACRO", "NEWS"]);
  assert.deepEqual(result.staleSources, ["CHART"]);
  assert.equal(result.signals[1].score, 0.2667);
  assert.equal(Object.isFrozen(result.signals), true);
});

test("rejects duplicate and future observations", () => {
  assert.throws(() => fuseMarketIntelligence(150, [observation(), observation()]), /duplicate observation id/);
  assert.throws(() => fuseMarketIntelligence(150, [observation({ observedAt: 151 })]), /observedAt is invalid/);
});

test("reports healthy paper operation", () => {
  const snapshot = buildOperationalSnapshot({
    now: 200,
    mode: "PAPER",
    killSwitchActive: false,
    api: "HEALTHY",
    database: "HEALTHY",
    marketData: "HEALTHY",
    intelligence: "HEALTHY",
    exchange: "HEALTHY",
    lastDecisionAt: 190
  });
  assert.equal(snapshot.overall, "HEALTHY");
  assert.equal(snapshot.tradingAllowed, true);
  assert.equal(snapshot.nextAction, "NONE");
});

test("fails closed on service outage and kill switch", () => {
  const outage = buildOperationalSnapshot({
    now: 200,
    mode: "PAPER",
    killSwitchActive: false,
    api: "HEALTHY",
    database: "DOWN",
    marketData: "HEALTHY",
    intelligence: "HEALTHY",
    exchange: "HEALTHY"
  });
  assert.equal(outage.overall, "DOWN");
  assert.equal(outage.tradingAllowed, false);
  assert.equal(outage.nextAction, "EMERGENCY_STOP");

  const killed = buildOperationalSnapshot({
    now: 200,
    mode: "STOPPED",
    killSwitchActive: true,
    api: "HEALTHY",
    database: "HEALTHY",
    marketData: "HEALTHY",
    intelligence: "HEALTHY",
    exchange: "HEALTHY"
  });
  assert.equal(killed.tradingAllowed, false);
  assert.match(killed.issues[0], /Kill switch/);
});
