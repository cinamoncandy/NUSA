const test = require("node:test");
const assert = require("node:assert/strict");
const { EmaIndicator } = require("../dist/apps/server/src/pipeline/emaIndicator.js");

function assertClose(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) < epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

test("first update seeds the EMA with the raw price", () => {
  const ema = new EmaIndicator(3);
  assert.equal(ema.current, undefined);
  assert.equal(ema.update(100), 100);
  assert.equal(ema.current, 100);
});

test("subsequent updates blend by alpha = 2 / (period + 1)", () => {
  const ema = new EmaIndicator(3); // alpha = 0.5
  ema.update(10);
  const next = ema.update(20);
  assertClose(next, 15); // 10 + 0.5*(20-10)
  const next2 = ema.update(5);
  assertClose(next2, 10); // 15 + 0.5*(5-15)
});

test("requiredPeriod reflects the constructor argument", () => {
  assert.equal(new EmaIndicator(20).requiredPeriod, 20);
});

test("reset() clears state so the next update reseeds instead of blending", () => {
  const ema = new EmaIndicator(3);
  ema.update(10);
  ema.update(20);
  ema.reset();
  assert.equal(ema.current, undefined);
  assert.equal(ema.update(50), 50);
});

test("rejects invalid periods and non-positive/non-finite prices", () => {
  assert.throws(() => new EmaIndicator(1), /period/);
  assert.throws(() => new EmaIndicator(2.5), /period/);
  const ema = new EmaIndicator(3);
  assert.throws(() => ema.update(0), /price/);
  assert.throws(() => ema.update(-1), /price/);
  assert.throws(() => ema.update(Number.NaN), /price/);
});
