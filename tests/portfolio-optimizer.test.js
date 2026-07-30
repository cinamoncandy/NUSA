const test = require("node:test");
const assert = require("node:assert/strict");
const { optimizePortfolio } = require("../dist/apps/cloud/src/portfolioOptimizer.js");

const policy = { maximumGrossWeight: 0.8, minimumCashWeight: 0.2, maximumStrategyWeight: 0.5 };
test("optimizer allocates deterministically within policy limits", () => {
  const result = optimizePortfolio([{ strategyId: "slow", expectedReturn: 0.1, risk: 0.2, requestedWeight: 0.5 }, { strategyId: "fast", expectedReturn: 0.2, risk: 0.2, requestedWeight: 0.5 }], policy);
  assert.deepEqual(result.allocations, [{ strategyId: "fast", weight: 0.5 }, { strategyId: "slow", weight: 0.30000000000000004 }]);
  assert.equal(result.productionMutationAllowed, false);
});

test("unattractive candidates are rejected and capital remains in cash", () => {
  const result = optimizePortfolio([{ strategyId: "bad", expectedReturn: -0.1, risk: 0.2, requestedWeight: 0.5 }], policy);
  assert.deepEqual(result.allocations, []);
  assert.deepEqual(result.rejectedStrategyIds, ["bad"]);
  assert.equal(result.cashWeight, 1);
});
