const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPortfolioPlan } = require("../dist/apps/cloud/src/portfolioOrchestrator.js");
const { buildPortfolioBriefing } = require("../dist/apps/mobile/src/portfolioBriefing.js");

const decision = (symbol, overrides = {}) => ({
  symbol,
  action: "BUY",
  confidence: 0.8,
  risk: "LOW",
  allocation: 0.4,
  leverage: 2,
  score: 0.6,
  reasons: Object.freeze(["CHART: trend"]),
  decidedAt: 100,
  ...overrides
});

const input = (overrides = {}) => ({
  now: 100,
  deployableCapital: 100000,
  reservedCapital: 30000,
  maxFuturesShare: 0.25,
  maxGrossShare: 0.7,
  candidates: [
    { decision: decision("BTCUSDT"), instrument: "SPOT" },
    { decision: decision("ETHUSDT", { confidence: 0.7 }), instrument: "FUTURES" }
  ],
  ...overrides
});

test("builds a deterministic plan within gross and futures caps", () => {
  const plan = buildPortfolioPlan(input());
  assert.equal(plan.grossShare, 0.65);
  assert.equal(plan.futuresShare, 0.25);
  assert.equal(plan.deployedCapital, 65000);
  assert.equal(plan.cashCapital, 35000);
  assert.deepEqual(plan, buildPortfolioPlan(input()));
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.allocations), true);
});

test("skips wait, exit, sell and zero-allocation decisions", () => {
  const plan = buildPortfolioPlan(input({ candidates: [
    { decision: decision("BTCUSDT", { action: "WAIT", allocation: 0 }), instrument: "SPOT" },
    { decision: decision("ETHUSDT", { action: "EXIT", allocation: 0 }), instrument: "FUTURES" }
  ] }));
  assert.equal(plan.allocations.length, 0);
  assert.equal(plan.cashCapital, 100000);
});

test("rejects duplicate candidates and future decisions", () => {
  const duplicate = { decision: decision("BTCUSDT"), instrument: "SPOT" };
  assert.throws(() => buildPortfolioPlan(input({ candidates: [duplicate, duplicate] })), /duplicate portfolio candidate/);
  assert.throws(() => buildPortfolioPlan(input({ candidates: [{ decision: decision("BTCUSDT", { decidedAt: 101 }), instrument: "SPOT" }] })), /future/);
});

test("creates a mobile briefing without mixing reserved capital into deployable capital", () => {
  const briefing = buildPortfolioBriefing(buildPortfolioPlan(input()));
  assert.equal(briefing.reservedCapital, 30000);
  assert.equal(briefing.spotCapital, 40000);
  assert.equal(briefing.futuresCapital, 25000);
  assert.equal(briefing.status, "ACTIVE");
  assert.equal(Object.isFrozen(briefing.positions), true);
});

test("marks a portfolio protected when reserved capital dominates", () => {
  const briefing = buildPortfolioBriefing(buildPortfolioPlan(input({ reservedCapital: 90000, candidates: [] })));
  assert.equal(briefing.status, "PROTECTED");
  assert.match(briefing.headline, /보호/);
});
