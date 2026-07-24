const test = require("node:test");
const assert = require("node:assert/strict");
const { PositionSizerOrderPlanner } = require("../dist/apps/server/src/pipeline/positionSizerAdapter.js");

function intent(type) { return { type, reason: "test", confidence: 1, timestamp: 0 }; }
const baseContext = { equity: 10_000_000, price: 100_000_000, positionQuantity: 0, fixedOrderQuantity: 0.001 };

test("HOLD never produces a plan", () => {
  const adapter = new PositionSizerOrderPlanner(() => ({ mode: "FIXED", fixedQuantity: 0.001 }));
  assert.equal(adapter.plan(intent("HOLD"), baseContext), null);
});

test("FIXED mode delegates to PositionSizer and returns the sized quantity for BUY", () => {
  const adapter = new PositionSizerOrderPlanner((context) => ({ mode: "FIXED", fixedQuantity: context.fixedOrderQuantity }));
  const plan = adapter.plan(intent("BUY"), baseContext);
  assert.deepEqual(plan, { side: "BUY", quantity: 0.001 });
});

test("FIXED_FRACTIONAL mode sizes from equity * riskFraction / price via PositionSizer", () => {
  const adapter = new PositionSizerOrderPlanner(() => ({ mode: "FIXED_FRACTIONAL", riskFraction: 0.01 }));
  const plan = adapter.plan(intent("BUY"), baseContext);
  assert.equal(plan.side, "BUY");
  assert.ok(Math.abs(plan.quantity - 0.001) < 1e-9); // 10_000_000 * 0.01 / 100_000_000
});

test("SELL quantity is still capped to the current position (PositionSizer itself does not cap this)", () => {
  const adapter = new PositionSizerOrderPlanner(() => ({ mode: "FIXED", fixedQuantity: 0.01 }));
  const plan = adapter.plan(intent("SELL"), { ...baseContext, positionQuantity: 0.0005 });
  assert.deepEqual(plan, { side: "SELL", quantity: 0.0005 });
});

test("SELL with zero position produces no plan", () => {
  const adapter = new PositionSizerOrderPlanner(() => ({ mode: "FIXED", fixedQuantity: 0.01 }));
  assert.equal(adapter.plan(intent("SELL"), { ...baseContext, positionQuantity: 0 }), null);
});

test("a FAILED PositionSizingResult (e.g. invalid policy) produces no plan rather than throwing", () => {
  const adapter = new PositionSizerOrderPlanner(() => ({ mode: "FIXED_FRACTIONAL", riskFraction: -1 }));
  assert.equal(adapter.plan(intent("BUY"), baseContext), null);
});
