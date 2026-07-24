const test = require("node:test");
const assert = require("node:assert/strict");
const { filledExecutionReport, rejectedExecutionReport } = require("../dist/packages/core/src/execution/executionReport.js");

const clone = (value) => JSON.parse(JSON.stringify(value));

test("filledExecutionReport computes orderValue = price * quantity", () => {
  const report = filledExecutionReport({ side: "BUY", quantity: 2, price: 100, fee: 0.2 });
  assert.deepEqual(report, { status: "FILLED", side: "BUY", quantity: 2, price: 100, fee: 0.2, orderValue: 200 });
});

test("filledExecutionReport copies strategyId/symbol when present, omits when absent", () => {
  const withIds = filledExecutionReport({ side: "SELL", quantity: 1, price: 50, fee: 0.05, strategyId: "sma-crossover", symbol: "KRW-BTC" });
  assert.equal(withIds.strategyId, "sma-crossover");
  assert.equal(withIds.symbol, "KRW-BTC");

  const withoutIds = filledExecutionReport({ side: "SELL", quantity: 1, price: 50, fee: 0.05 });
  assert.equal(withoutIds.strategyId, undefined);
  assert.equal(withoutIds.symbol, undefined);
});

test("rejectedExecutionReport carries the reason as-is", () => {
  const report = rejectedExecutionReport("insufficient paper cash");
  assert.deepEqual(report, { status: "REJECTED", reason: "insufficient paper cash" });
});

test("neither builder mutates its input", () => {
  const input = Object.freeze({ side: "BUY", quantity: 2, price: 100, fee: 0.2, strategyId: "s", symbol: "KRW-BTC" });
  const before = clone(input);
  filledExecutionReport(input);
  assert.deepEqual(clone(input), before);
});

test("both builders are deterministic", () => {
  const results = Array.from({ length: 5 }, () => filledExecutionReport({ side: "BUY", quantity: 2, price: 100, fee: 0.2 }));
  for (const result of results) assert.deepEqual(result, results[0]);
});
