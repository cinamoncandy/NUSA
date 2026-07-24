const test = require("node:test");
const assert = require("node:assert/strict");
const { DefaultOrderPlanner } = require("../dist/packages/core/src/order/orderPlanner.js");

const clone = (value) => JSON.parse(JSON.stringify(value));

function intent(side, quantity, extra = {}) {
  return Object.freeze({ side, quantity, ...extra });
}
function policy(feeRate, slippageRate) {
  return Object.freeze({ feeRate, slippageRate });
}
function allow(orderValue = 0) {
  return Object.freeze({ outcome: "ALLOW", orderValue });
}
function block(code = "BELOW_MINIMUM_ORDER_VALUE", reason = "test block") {
  return Object.freeze({ outcome: "BLOCK", code, reason });
}

test("1. BUY normal calculation", () => {
  const planner = new DefaultOrderPlanner();
  const result = planner.plan(intent("BUY", 2), allow(), 100, policy(0.001, 0.01));
  assert.equal(result.status, "PLANNED");
  assert.equal(result.order.executionPrice, 101);
  assert.equal(result.order.orderValue, 202);
  assert.ok(Math.abs(result.order.estimatedFee - 0.202) < 1e-9);
  assert.equal(result.order.estimatedSlippage, 2);
  assert.equal(result.order.side, "BUY");
  assert.equal(result.order.orderType, "MARKET");
  assert.equal(result.order.quantity, 2);
  assert.equal(result.order.marketPrice, 100);
});

test("2. SELL normal calculation", () => {
  const planner = new DefaultOrderPlanner();
  const result = planner.plan(intent("SELL", 2), allow(), 100, policy(0.001, 0.01));
  assert.equal(result.status, "PLANNED");
  assert.equal(result.order.executionPrice, 99);
  assert.equal(result.order.orderValue, 198);
  assert.ok(Math.abs(result.order.estimatedFee - 0.198) < 1e-9);
  assert.equal(result.order.estimatedSlippage, 2);
});

test("3. zero fee and zero slippage", () => {
  const planner = new DefaultOrderPlanner();
  const result = planner.plan(intent("BUY", 2), allow(), 100, policy(0, 0));
  assert.equal(result.status, "PLANNED");
  assert.equal(result.order.executionPrice, 100);
  assert.equal(result.order.estimatedFee, 0);
  assert.equal(result.order.estimatedSlippage, 0);
});

test("4. feeRate boundaries", () => {
  const planner = new DefaultOrderPlanner();
  assert.equal(planner.plan(intent("BUY", 1), allow(), 100, policy(0, 0.01)).status, "PLANNED");
  assert.equal(planner.plan(intent("BUY", 1), allow(), 100, policy(1, 0.01)).status, "PLANNED");
  const negative = planner.plan(intent("BUY", 1), allow(), 100, policy(-0.001, 0.01));
  assert.equal(negative.status, "FAILED");
  assert.equal(negative.code, "INVALID_POLICY");
  const overOne = planner.plan(intent("BUY", 1), allow(), 100, policy(1.001, 0.01));
  assert.equal(overOne.status, "FAILED");
  assert.equal(overOne.code, "INVALID_POLICY");
});

test("5. slippageRate boundaries, including the SELL executionPrice=0 special case", () => {
  const planner = new DefaultOrderPlanner();
  assert.equal(planner.plan(intent("BUY", 1), allow(), 100, policy(0.001, 0)).status, "PLANNED");
  // slippageRate = 1 is policy-valid, but for SELL it drives executionPrice to exactly 0.
  const sellAtOne = planner.plan(intent("SELL", 1), allow(), 100, policy(0.001, 1));
  assert.equal(sellAtOne.status, "FAILED");
  assert.equal(sellAtOne.code, "INVALID_EXECUTION_PRICE");
  // For BUY the same slippageRate=1 is fine (executionPrice = 2 * marketPrice).
  const buyAtOne = planner.plan(intent("BUY", 1), allow(), 100, policy(0.001, 1));
  assert.equal(buyAtOne.status, "PLANNED");
  assert.equal(buyAtOne.order.executionPrice, 200);

  const negative = planner.plan(intent("BUY", 1), allow(), 100, policy(0.001, -0.01));
  assert.equal(negative.status, "FAILED");
  assert.equal(negative.code, "INVALID_POLICY");
  const overOne = planner.plan(intent("BUY", 1), allow(), 100, policy(0.001, 1.01));
  assert.equal(overOne.status, "FAILED");
  assert.equal(overOne.code, "INVALID_POLICY");
});

test("6. a BLOCKed RiskDecision returns RISK_BLOCKED without performing any further calculation", () => {
  const planner = new DefaultOrderPlanner();
  const result = planner.plan(intent("BUY", 2), block("INSUFFICIENT_BALANCE", "not enough cash"), 100, policy(0.001, 0.01));
  assert.equal(result.status, "FAILED");
  assert.equal(result.code, "RISK_BLOCKED");
  assert.match(result.reason, /INSUFFICIENT_BALANCE/);
  assert.equal(Object.keys(result).includes("order"), false);
});

test("7. invalid marketPrice values", () => {
  const planner = new DefaultOrderPlanner();
  for (const marketPrice of [0, -100, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const result = planner.plan(intent("BUY", 2), allow(), marketPrice, policy(0.001, 0.01));
    assert.equal(result.status, "FAILED", `marketPrice=${marketPrice}`);
    assert.equal(result.code, "INVALID_MARKET_PRICE");
  }
});

test("8. invalid quantity values", () => {
  const planner = new DefaultOrderPlanner();
  for (const quantity of [0, -2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const result = planner.plan(intent("BUY", quantity), allow(), 100, policy(0.001, 0.01));
    assert.equal(result.status, "FAILED", `quantity=${quantity}`);
    assert.equal(result.code, "INVALID_QUANTITY");
  }
});

test("9. overflow to a non-finite executionPrice or orderValue fails closed", () => {
  const planner = new DefaultOrderPlanner();
  const hugeMarketPrice = planner.plan(intent("BUY", 2), allow(), 1e308, policy(0.001, 1));
  assert.equal(hugeMarketPrice.status, "FAILED");
  assert.equal(hugeMarketPrice.code, "INVALID_EXECUTION_PRICE");

  const hugeQuantity = planner.plan(intent("BUY", 1e200), allow(), 1e200, policy(0.001, 0));
  assert.equal(hugeQuantity.status, "FAILED");
  assert.equal(hugeQuantity.code, "INVALID_ORDER_VALUE");
});

test("10. validation order: the first applicable failure wins even with multiple invalid inputs", () => {
  const planner = new DefaultOrderPlanner();
  // BLOCK + invalid marketPrice + invalid quantity simultaneously -> RISK_BLOCKED (step 1).
  const blockWins = planner.plan(intent("BUY", -5), block(), -100, policy(0.001, 0.01));
  assert.equal(blockWins.status, "FAILED");
  assert.equal(blockWins.code, "RISK_BLOCKED");

  // ALLOW + invalid policy + invalid marketPrice + invalid quantity -> INVALID_POLICY (step 2).
  const policyWins = planner.plan(intent("BUY", -5), allow(), -100, policy(-1, 0.01));
  assert.equal(policyWins.status, "FAILED");
  assert.equal(policyWins.code, "INVALID_POLICY");

  // ALLOW + valid policy + invalid marketPrice + invalid quantity -> INVALID_MARKET_PRICE (step 3).
  const marketPriceWins = planner.plan(intent("BUY", -5), allow(), -100, policy(0.001, 0.01));
  assert.equal(marketPriceWins.status, "FAILED");
  assert.equal(marketPriceWins.code, "INVALID_MARKET_PRICE");
});

test("11. inputs (TradingIntent, RiskDecision, ExecutionPolicy) are never mutated", () => {
  const planner = new DefaultOrderPlanner();
  const intentValue = intent("BUY", 2, { strategyId: "sma-crossover", symbol: "KRW-BTC" });
  const decisionValue = allow(202);
  const policyValue = policy(0.001, 0.01);
  const intentBefore = clone(intentValue);
  const decisionBefore = clone(decisionValue);
  const policyBefore = clone(policyValue);

  planner.plan(intentValue, decisionValue, 100, policyValue);

  assert.deepEqual(clone(intentValue), intentBefore);
  assert.deepEqual(clone(decisionValue), decisionBefore);
  assert.deepEqual(clone(policyValue), policyBefore);
});

test("12. plan() is deterministic: identical inputs always produce identical results", () => {
  const planner = new DefaultOrderPlanner();
  const results = Array.from({ length: 5 }, () => planner.plan(intent("BUY", 2), allow(), 100, policy(0.001, 0.01)));
  for (const result of results) assert.deepEqual(result, results[0]);

  const failedResults = Array.from({ length: 5 }, () => planner.plan(intent("BUY", -2), allow(), 100, policy(0.001, 0.01)));
  for (const result of failedResults) assert.deepEqual(result, failedResults[0]);
});

test("strategyId/symbol are copied from TradingIntent into PlannedOrder when present, omitted when absent", () => {
  const planner = new DefaultOrderPlanner();
  const withIds = planner.plan(intent("BUY", 2, { strategyId: "sma-crossover", symbol: "KRW-BTC" }), allow(), 100, policy(0.001, 0.01));
  assert.equal(withIds.order.strategyId, "sma-crossover");
  assert.equal(withIds.order.symbol, "KRW-BTC");

  const withoutIds = planner.plan(intent("BUY", 2), allow(), 100, policy(0.001, 0.01));
  assert.equal(withoutIds.order.strategyId, undefined);
  assert.equal(withoutIds.order.symbol, undefined);
});
