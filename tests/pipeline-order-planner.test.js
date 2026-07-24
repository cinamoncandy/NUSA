const test = require("node:test");
const assert = require("node:assert/strict");
const { FixedOrderPlanner } = require("../dist/apps/server/src/pipeline/orderPlanner.js");

function intent(type) { return { type, reason: "test", confidence: 1, timestamp: 0 }; }
const baseContext = { equity: 10_000_000, price: 100_000_000, positionQuantity: 0, fixedOrderQuantity: 0.001 };

test("HOLD never produces a plan", () => {
  const planner = new FixedOrderPlanner();
  assert.equal(planner.plan(intent("HOLD"), baseContext), null);
});

test("FIXED mode (default) uses fixedOrderQuantity as-is for BUY", () => {
  const planner = new FixedOrderPlanner();
  const plan = planner.plan(intent("BUY"), baseContext);
  assert.deepEqual(plan, { side: "BUY", quantity: 0.001 });
});

test("FIXED mode caps SELL quantity to the current position", () => {
  const planner = new FixedOrderPlanner();
  const plan = planner.plan(intent("SELL"), { ...baseContext, positionQuantity: 0.0005 });
  assert.deepEqual(plan, { side: "SELL", quantity: 0.0005 });
});

test("SELL with zero position produces no plan", () => {
  const planner = new FixedOrderPlanner();
  assert.equal(planner.plan(intent("SELL"), { ...baseContext, positionQuantity: 0 }), null);
});

test("FIXED_FRACTIONAL mode sizes from equity * riskFraction / price", () => {
  const planner = new FixedOrderPlanner("FIXED_FRACTIONAL", 0.01);
  // 10_000_000 * 0.01 / 100_000_000 = 0.001
  const plan = planner.plan(intent("BUY"), baseContext);
  assert.equal(plan.side, "BUY");
  assert.ok(Math.abs(plan.quantity - 0.001) < 1e-9);
});

test("FIXED_FRACTIONAL mode floors to quantityStep when provided", () => {
  const planner = new FixedOrderPlanner("FIXED_FRACTIONAL", 0.0123);
  const plan = planner.plan(intent("BUY"), { ...baseContext, equity: 1_000_000, price: 100_000_000, quantityStep: 0.0001 });
  // raw = 1_000_000 * 0.0123 / 100_000_000 = 0.000123 -> floored to 0.0001
  assert.equal(plan.quantity, 0.0001);
});

test("constructor requires a valid riskFraction when sizingMode is FIXED_FRACTIONAL", () => {
  assert.throws(() => new FixedOrderPlanner("FIXED_FRACTIONAL"), /riskFraction/);
  assert.throws(() => new FixedOrderPlanner("FIXED_FRACTIONAL", 0), /riskFraction/);
  assert.throws(() => new FixedOrderPlanner("FIXED_FRACTIONAL", 1.5), /riskFraction/);
});
