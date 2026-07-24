const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateOpportunity } = require("../dist/apps/cloud/src/opportunityLifecycle.js");

const base = (overrides = {}) => ({
  id: "opp-1",
  symbol: "BTCUSDT",
  now: 1_000,
  state: "DETECTED",
  minimumNetEdgeBps: 10,
  estimatedExecutionCostBps: 2,
  killSwitchActive: false,
  signals: [{ source: "funding", observedAt: 900, halfLifeMs: 1_000, edgeBps: 20, confidence: 1 }],
  ...overrides
});

test("builds when decayed net edge remains above threshold", () => {
  const result = evaluateOpportunity(base());
  assert.equal(result.action, "BUILD");
  assert.equal(result.state, "BUILDING");
  assert.ok(result.netDecayedEdgeBps >= 10);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.reasons));
});

test("reduces active exposure when edge decays below threshold", () => {
  const result = evaluateOpportunity(base({ now: 3_500, state: "ACTIVE" }));
  assert.equal(result.action, "REDUCE");
  assert.equal(result.state, "REDUCING");
});

test("exits active opportunity when costs make edge negative", () => {
  const result = evaluateOpportunity(base({ state: "ACTIVE", estimatedExecutionCostBps: 30 }));
  assert.equal(result.action, "EXIT");
  assert.equal(result.state, "EXITING");
  assert.ok(result.reasons.includes("NEGATIVE_NET_EDGE"));
});

test("kill switch always exits open lifecycle", () => {
  const result = evaluateOpportunity(base({ state: "ACTIVE", killSwitchActive: true }));
  assert.equal(result.action, "EXIT");
  assert.equal(result.state, "EXITING");
});

test("expired opportunities reject new entry", () => {
  const result = evaluateOpportunity(base({ now: 10_000 }));
  assert.equal(result.action, "REJECT");
  assert.equal(result.state, "EXPIRED");
});

test("same input is deterministic and invalid signals fail closed", () => {
  assert.deepEqual(evaluateOpportunity(base()), evaluateOpportunity(base()));
  assert.throws(() => evaluateOpportunity(base({ signals: [] })), /at least one signal/);
  assert.throws(() => evaluateOpportunity(base({ signals: [{ source: "x", observedAt: 2_000, halfLifeMs: 100, edgeBps: 1, confidence: 1 }] })), /timing/);
});
