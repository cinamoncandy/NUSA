const test = require("node:test");
const assert = require("node:assert/strict");
const { planTemporalBinaryHedge } = require("../dist/apps/cloud/src/temporalBinaryHedgePlanner.js");

const base = (overrides = {}) => ({
  now: 1_000,
  fills: [],
  nextOutcome: "UP",
  nextPrice: 0.32,
  availableCapital: 100,
  targetProtectedQuantity: 10,
  maxUnhedgedCapital: 20,
  minimumLockedEdge: 0.02,
  lowPriceThreshold: 0.5,
  lowPriceSizeMultiplier: 0.25,
  highPriceSizeMultiplier: 1,
  ...overrides
});

test("uses smaller size at low prices", () => {
  const plan = planTemporalBinaryHedge(base());
  assert.equal(plan.status, "BUILD");
  assert.equal(plan.quantity, 2.5);
  assert.equal(plan.estimatedCost, 0.8);
});

test("completes a protected set only when combined cost preserves edge", () => {
  const plan = planTemporalBinaryHedge(base({
    fills: [{ outcome: "UP", price: 0.32, quantity: 10, fee: 0, filledAt: 900 }],
    nextOutcome: "DOWN",
    nextPrice: 0.41,
    lowPriceSizeMultiplier: 1
  }));
  assert.equal(plan.status, "COMPLETE_SET");
  assert.equal(plan.quantity, 10);
  assert.equal(plan.protectedQuantityAfter, 10);
  assert.equal(plan.weightedCompleteSetCost, 0.73);
  assert.equal(plan.lockedEdgePerSet, 0.27);
});

test("rejects a hedge whose complete-set edge is too small", () => {
  const plan = planTemporalBinaryHedge(base({
    fills: [{ outcome: "UP", price: 0.55, quantity: 10, fee: 0.1, filledAt: 900 }],
    nextOutcome: "DOWN",
    nextPrice: 0.46,
    lowPriceSizeMultiplier: 1,
    minimumLockedEdge: 0.01
  }));
  assert.equal(plan.status, "REJECT");
  assert.match(plan.reason, /edge is below minimum/);
});

test("rejects projected one-sided exposure above the configured limit", () => {
  const plan = planTemporalBinaryHedge(base({
    nextPrice: 0.8,
    availableCapital: 100,
    highPriceSizeMultiplier: 2,
    maxUnhedgedCapital: 5
  }));
  assert.equal(plan.status, "REJECT");
  assert.match(plan.reason, /unhedged capital exceeds limit/);
});

test("fails closed on future fills and malformed prices", () => {
  assert.throws(() => planTemporalBinaryHedge(base({
    fills: [{ outcome: "UP", price: 0.3, quantity: 1, fee: 0, filledAt: 1_001 }]
  })), /filledAt is invalid/);
  assert.throws(() => planTemporalBinaryHedge(base({ nextPrice: 1 })), /strictly between 0 and 1/);
});

test("returns immutable plans", () => {
  const plan = planTemporalBinaryHedge(base());
  assert.equal(Object.isFrozen(plan), true);
});
