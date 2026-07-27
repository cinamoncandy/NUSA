const test = require("node:test");
const assert = require("node:assert/strict");
const { DefaultPositionSizer } = require("../dist/packages/core/src/position/positionSizer.js");

const clone = (value) => JSON.parse(JSON.stringify(value));

function intent(side, extra = {}) {
  return Object.freeze({ side, ...extra });
}
function context(equity, marketPrice) {
  return Object.freeze({ equity, marketPrice });
}

test("FIXED mode uses fixedQuantity as-is", () => {
  const sizer = new DefaultPositionSizer();
  const result = sizer.size(intent("BUY"), context(10_000_000, 100_000_000), { mode: "FIXED", fixedQuantity: 0.001 });
  assert.equal(result.status, "SIZED");
  assert.equal(result.intent.quantity, 0.001);
  assert.equal(result.intent.side, "BUY");
});

test("FIXED_FRACTIONAL mode sizes from equity * riskFraction / marketPrice", () => {
  const sizer = new DefaultPositionSizer();
  const result = sizer.size(intent("BUY"), context(10_000_000, 100_000_000), { mode: "FIXED_FRACTIONAL", riskFraction: 0.01 });
  assert.equal(result.status, "SIZED");
  assert.ok(Math.abs(result.intent.quantity - 0.001) < 1e-12); // 10_000_000 * 0.01 / 100_000_000
});

test("FIXED_FRACTIONAL floors to quantityStep when provided", () => {
  const sizer = new DefaultPositionSizer();
  const result = sizer.size(intent("BUY"), context(1_000_000, 100_000_000), { mode: "FIXED_FRACTIONAL", riskFraction: 0.0123, quantityStep: 0.0001 });
  // raw = 1_000_000 * 0.0123 / 100_000_000 = 0.000123 -> floored to 0.0001
  assert.equal(result.status, "SIZED");
  assert.equal(result.intent.quantity, 0.0001);
});

test("FIXED_FRACTIONAL without quantityStep returns the raw unfloored quotient", () => {
  const sizer = new DefaultPositionSizer();
  const result = sizer.size(intent("SELL"), context(10_000_000, 50_000_000), { mode: "FIXED_FRACTIONAL", riskFraction: 0.02 });
  assert.equal(result.status, "SIZED");
  assert.ok(Math.abs(result.intent.quantity - 0.004) < 1e-12); // 10_000_000 * 0.02 / 50_000_000
});

test("INVALID_POLICY: FIXED mode requires a valid fixedQuantity", () => {
  const sizer = new DefaultPositionSizer();
  for (const fixedQuantity of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = sizer.size(intent("BUY"), context(10_000_000, 100_000_000), { mode: "FIXED", fixedQuantity });
    assert.equal(result.status, "FAILED", `fixedQuantity=${fixedQuantity}`);
    assert.equal(result.code, "INVALID_POLICY");
  }
});

test("INVALID_POLICY: FIXED_FRACTIONAL mode requires riskFraction in (0, 1]", () => {
  const sizer = new DefaultPositionSizer();
  for (const riskFraction of [undefined, 0, -0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = sizer.size(intent("BUY"), context(10_000_000, 100_000_000), { mode: "FIXED_FRACTIONAL", riskFraction });
    assert.equal(result.status, "FAILED", `riskFraction=${riskFraction}`);
    assert.equal(result.code, "INVALID_POLICY");
  }
  // riskFraction = 1 is the inclusive boundary and must be accepted.
  const atOne = sizer.size(intent("BUY"), context(10_000_000, 100_000_000), { mode: "FIXED_FRACTIONAL", riskFraction: 1 });
  assert.equal(atOne.status, "SIZED");
});

test("INVALID_POLICY: an unknown sizing mode is rejected", () => {
  const sizer = new DefaultPositionSizer();
  const result = sizer.size(intent("BUY"), context(10_000_000, 100_000_000), { mode: "PERCENT_OF_BALANCE" });
  assert.equal(result.status, "FAILED");
  assert.equal(result.code, "INVALID_POLICY");
});

test("INVALID_POLICY: a provided quantityStep must be finite and positive", () => {
  const sizer = new DefaultPositionSizer();
  for (const quantityStep of [0, -0.0001, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = sizer.size(intent("BUY"), context(10_000_000, 100_000_000), { mode: "FIXED", fixedQuantity: 0.001, quantityStep });
    assert.equal(result.status, "FAILED", `quantityStep=${quantityStep}`);
    assert.equal(result.code, "INVALID_POLICY");
  }
});

test("INVALID_EQUITY: equity must be finite and positive", () => {
  const sizer = new DefaultPositionSizer();
  for (const equity of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = sizer.size(intent("BUY"), context(equity, 100_000_000), { mode: "FIXED_FRACTIONAL", riskFraction: 0.01 });
    assert.equal(result.status, "FAILED", `equity=${equity}`);
    assert.equal(result.code, "INVALID_EQUITY");
  }
});

test("INVALID_MARKET_PRICE: marketPrice must be finite and positive", () => {
  const sizer = new DefaultPositionSizer();
  for (const marketPrice of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = sizer.size(intent("BUY"), context(10_000_000, marketPrice), { mode: "FIXED_FRACTIONAL", riskFraction: 0.01 });
    assert.equal(result.status, "FAILED", `marketPrice=${marketPrice}`);
    assert.equal(result.code, "INVALID_MARKET_PRICE");
  }
});

test("ZERO_QUANTITY: a raw quantity below one quantityStep floors to zero and fails closed", () => {
  const sizer = new DefaultPositionSizer();
  const result = sizer.size(intent("BUY"), context(100, 100_000_000), { mode: "FIXED_FRACTIONAL", riskFraction: 0.01, quantityStep: 0.0001 });
  assert.equal(result.status, "FAILED");
  assert.equal(result.code, "ZERO_QUANTITY");
});

test("validation order: the first applicable failure wins even with multiple invalid inputs", () => {
  const sizer = new DefaultPositionSizer();
  // Invalid policy + invalid equity + invalid marketPrice simultaneously -> INVALID_POLICY (step 1).
  const policyWins = sizer.size(intent("BUY"), context(-1, -1), { mode: "FIXED_FRACTIONAL", riskFraction: -1 });
  assert.equal(policyWins.status, "FAILED");
  assert.equal(policyWins.code, "INVALID_POLICY");

  // Valid policy + invalid equity + invalid marketPrice -> INVALID_EQUITY (step 2).
  const equityWins = sizer.size(intent("BUY"), context(-1, -1), { mode: "FIXED_FRACTIONAL", riskFraction: 0.01 });
  assert.equal(equityWins.status, "FAILED");
  assert.equal(equityWins.code, "INVALID_EQUITY");
});

test("strategyId/symbol are copied through into the sized intent; quantity is always overridden", () => {
  const sizer = new DefaultPositionSizer();
  const result = sizer.size(
    intent("SELL", { strategyId: "ema-crossover", symbol: "KRW-BTC", quantity: 999 }),
    context(10_000_000, 100_000_000),
    { mode: "FIXED", fixedQuantity: 0.002 }
  );
  assert.equal(result.status, "SIZED");
  assert.equal(result.intent.strategyId, "ema-crossover");
  assert.equal(result.intent.symbol, "KRW-BTC");
  assert.equal(result.intent.side, "SELL");
  assert.equal(result.intent.quantity, 0.002, "PositionSizer must override any quantity already present on the input intent");
});

test("inputs (TradingIntent, SizingContext, SizingPolicy) are never mutated", () => {
  const sizer = new DefaultPositionSizer();
  const intentValue = intent("BUY", { strategyId: "sma-crossover", symbol: "KRW-BTC" });
  const contextValue = context(10_000_000, 100_000_000);
  const policyValue = Object.freeze({ mode: "FIXED_FRACTIONAL", riskFraction: 0.01, quantityStep: 0.0001 });
  const intentBefore = clone(intentValue);
  const contextBefore = clone(contextValue);
  const policyBefore = clone(policyValue);

  sizer.size(intentValue, contextValue, policyValue);

  assert.deepEqual(clone(intentValue), intentBefore);
  assert.deepEqual(clone(contextValue), contextBefore);
  assert.deepEqual(clone(policyValue), policyBefore);
});

test("size() is deterministic: identical inputs always produce identical results", () => {
  const sizer = new DefaultPositionSizer();
  const results = Array.from({ length: 5 }, () => sizer.size(intent("BUY"), context(10_000_000, 100_000_000), { mode: "FIXED_FRACTIONAL", riskFraction: 0.01 }));
  for (const result of results) assert.deepEqual(result, results[0]);

  const failedResults = Array.from({ length: 5 }, () => sizer.size(intent("BUY"), context(-1, 100_000_000), { mode: "FIXED", fixedQuantity: 0.001 }));
  for (const result of failedResults) assert.deepEqual(result, failedResults[0]);
});
