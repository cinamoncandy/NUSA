const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateFixedFractionalQuantity } = require("../dist/apps/desktop/src/paper/positionSizing.js");

test("scales quantity with equity: doubling equity doubles the sized quantity", () => {
  const small = calculateFixedFractionalQuantity({ equity: 1_000_000, price: 100_000_000, riskFraction: 0.01 });
  const large = calculateFixedFractionalQuantity({ equity: 2_000_000, price: 100_000_000, riskFraction: 0.01 });
  assertClose(small, 0.0001);
  assertClose(large, 0.0002);
});

test("scales inversely with price at fixed equity and riskFraction", () => {
  const atLowPrice = calculateFixedFractionalQuantity({ equity: 10_000_000, price: 50_000_000, riskFraction: 0.02 });
  const atHighPrice = calculateFixedFractionalQuantity({ equity: 10_000_000, price: 100_000_000, riskFraction: 0.02 });
  assertClose(atLowPrice, 0.004);
  assertClose(atHighPrice, 0.002);
});

test("floors to the provided quantityStep the same way PaperBroker does", () => {
  const quantity = calculateFixedFractionalQuantity({ equity: 1_000_000, price: 100_000_000, riskFraction: 0.0123, quantityStep: 0.0001 });
  // raw = 1_000_000 * 0.0123 / 100_000_000 = 0.000123 -> floored to 0.0001 step -> 0.0001
  assert.equal(quantity, 0.0001);
});

test("returns 0 rather than a negative or fractional-step quantity when the raw amount is below one step", () => {
  const quantity = calculateFixedFractionalQuantity({ equity: 100, price: 100_000_000, riskFraction: 0.01, quantityStep: 0.0001 });
  assert.equal(quantity, 0);
});

test("without quantityStep, returns the raw unfloored quotient", () => {
  const quantity = calculateFixedFractionalQuantity({ equity: 1_000_000, price: 100_000_000, riskFraction: 0.01 });
  assertClose(quantity, 0.0001);
});

test("rejects non-positive equity, price, quantityStep, and out-of-range riskFraction", () => {
  assert.throws(() => calculateFixedFractionalQuantity({ equity: 0, price: 100, riskFraction: 0.01 }), /equity/);
  assert.throws(() => calculateFixedFractionalQuantity({ equity: 100, price: 0, riskFraction: 0.01 }), /price/);
  assert.throws(() => calculateFixedFractionalQuantity({ equity: 100, price: 100, riskFraction: 0 }), /riskFraction/);
  assert.throws(() => calculateFixedFractionalQuantity({ equity: 100, price: 100, riskFraction: 1.5 }), /riskFraction/);
  assert.throws(() => calculateFixedFractionalQuantity({ equity: 100, price: 100, riskFraction: 0.01, quantityStep: -1 }), /quantityStep/);
  assert.throws(() => calculateFixedFractionalQuantity({ equity: Number.NaN, price: 100, riskFraction: 0.01 }), /equity/);
});

function assertClose(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) < epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}
