const test = require("node:test");
const assert = require("node:assert/strict");
const { buildOpportunitySchedule } = require("../dist/apps/cloud/src/opportunityScheduler.js");

const candidate = (id, overrides = {}) => ({
  id,
  asset: id,
  side: "LONG",
  netEdge: 0.12,
  confidence: 0.9,
  executionQuality: 0.9,
  liquidity: 0.9,
  remainingLifetimeMs: 9_000,
  initialLifetimeMs: 10_000,
  regimeFit: 0.9,
  maximumAllocation: 0.5,
  ...overrides
});

const input = (overrides = {}) => ({
  mode: "PAPER",
  killSwitchActive: false,
  deployableCapital: 1_000,
  maximumPortfolioAllocation: 0.6,
  maximumCorrelatedAllocation: 0.5,
  minimumScore: 0.01,
  candidates: [candidate("BTC"), candidate("ETH", { netEdge: 0.08 })],
  conflicts: [],
  ...overrides
});

test("ranks opportunities deterministically and preserves cash", () => {
  const result = buildOpportunitySchedule(input());
  assert.deepEqual(result.opportunities.map((item) => item.id), ["BTC", "ETH"]);
  assert.equal(result.totalAllocation, 600);
  assert.equal(result.reservedCash, 400);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.opportunities));
});

test("kill switch rejects every opportunity fail closed", () => {
  const result = buildOpportunitySchedule(input({ killSwitchActive: true }));
  assert.equal(result.totalAllocation, 0);
  assert.equal(result.rejected.length, 2);
  assert.ok(result.rejected.every((item) => item.reason === "KILL_SWITCH_ACTIVE"));
});

test("expired and non-positive edge opportunities are rejected", () => {
  const result = buildOpportunitySchedule(input({
    candidates: [candidate("EXPIRED", { remainingLifetimeMs: 0 }), candidate("NEGATIVE", { netEdge: -0.1 })]
  }));
  assert.equal(result.opportunities.length, 0);
  assert.deepEqual(result.rejected.map((item) => item.reason), ["INSUFFICIENT_LIVE_EDGE", "INSUFFICIENT_LIVE_EDGE"]);
});

test("same-direction correlated opportunities share a hard budget", () => {
  const result = buildOpportunitySchedule(input({
    maximumCorrelatedAllocation: 0.3,
    conflicts: [{ leftId: "BTC", rightId: "ETH", correlation: 0.95 }]
  }));
  assert.equal(result.opportunities[0].allocation, 180);
  assert.ok(result.opportunities.reduce((sum, item) => sum + item.allocation, 0) <= 600);
});

test("opposite directions do not consume same-direction correlation budget", () => {
  const result = buildOpportunitySchedule(input({
    maximumCorrelatedAllocation: 0.3,
    candidates: [candidate("BTC"), candidate("ETH", { side: "SHORT" })],
    conflicts: [{ leftId: "BTC", rightId: "ETH", correlation: 0.95 }]
  }));
  assert.equal(result.opportunities.length, 2);
});

test("duplicate ids and invalid conflicts fail closed", () => {
  assert.throws(() => buildOpportunitySchedule(input({ candidates: [candidate("BTC"), candidate("BTC")] })), /duplicate/);
  assert.throws(() => buildOpportunitySchedule(input({ conflicts: [{ leftId: "BTC", rightId: "MISSING", correlation: 0.9 }] })), /invalid opportunity conflict/);
});
