const test = require("node:test");
const assert = require("node:assert/strict");
const { DefaultPnLCalculator } = require("../dist/packages/core/src/pnl/pnl.js");

const clone = (value) => JSON.parse(JSON.stringify(value));

function portfolio(overrides = {}) {
  return Object.freeze({ cash: 0, quantity: 0, averagePrice: 0, realizedPnl: 0, ...overrides });
}

test("unrealizedPnl = quantity * (markPrice - averagePrice); totalPnl includes realizedPnl", () => {
  const calculator = new DefaultPnLCalculator();
  const result = calculator.calculate(portfolio({ quantity: 2, averagePrice: 100, realizedPnl: 50 }), 120);
  assert.equal(result.status, "CALCULATED");
  assert.equal(result.pnl.unrealizedPnl, 40);
  assert.equal(result.pnl.realizedPnl, 50);
  assert.equal(result.pnl.totalPnl, 90);
});

test("unrealizedPnl is negative when marked below averagePrice", () => {
  const calculator = new DefaultPnLCalculator();
  const result = calculator.calculate(portfolio({ quantity: 3, averagePrice: 100 }), 90);
  assert.equal(result.status, "CALCULATED");
  assert.equal(result.pnl.unrealizedPnl, -30);
});

test("a flat position (quantity 0) has zero unrealizedPnl regardless of markPrice", () => {
  const calculator = new DefaultPnLCalculator();
  const result = calculator.calculate(portfolio({ quantity: 0, averagePrice: 0, realizedPnl: 25 }), 999);
  assert.equal(result.status, "CALCULATED");
  assert.equal(result.pnl.unrealizedPnl, 0);
  assert.equal(result.pnl.totalPnl, 25);
});

test("INVALID_PORTFOLIO for negative or non-finite portfolio fields", () => {
  const calculator = new DefaultPnLCalculator();
  for (const bad of [
    portfolio({ quantity: -1 }),
    portfolio({ averagePrice: -1 }),
    portfolio({ quantity: Number.NaN }),
    portfolio({ realizedPnl: Number.POSITIVE_INFINITY })
  ]) {
    const result = calculator.calculate(bad, 100);
    assert.equal(result.status, "FAILED", JSON.stringify(bad));
    assert.equal(result.code, "INVALID_PORTFOLIO");
  }
});

test("INVALID_MARK_PRICE for zero, negative, NaN, or Infinity markPrice", () => {
  const calculator = new DefaultPnLCalculator();
  for (const markPrice of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = calculator.calculate(portfolio({ quantity: 1, averagePrice: 100 }), markPrice);
    assert.equal(result.status, "FAILED", `markPrice=${markPrice}`);
    assert.equal(result.code, "INVALID_MARK_PRICE");
  }
});

test("validation order: INVALID_PORTFOLIO wins even when markPrice is also invalid", () => {
  const calculator = new DefaultPnLCalculator();
  const result = calculator.calculate(portfolio({ quantity: -1 }), -1);
  assert.equal(result.status, "FAILED");
  assert.equal(result.code, "INVALID_PORTFOLIO");
});

test("calculate() never mutates the input portfolio", () => {
  const calculator = new DefaultPnLCalculator();
  const portfolioValue = portfolio({ quantity: 2, averagePrice: 100, realizedPnl: 10 });
  const before = clone(portfolioValue);
  calculator.calculate(portfolioValue, 120);
  assert.deepEqual(clone(portfolioValue), before);
});

test("calculate() is deterministic: identical inputs always produce identical results", () => {
  const calculator = new DefaultPnLCalculator();
  const results = Array.from({ length: 5 }, () => calculator.calculate(portfolio({ quantity: 2, averagePrice: 100, realizedPnl: 10 }), 120));
  for (const result of results) assert.deepEqual(result, results[0]);
});
