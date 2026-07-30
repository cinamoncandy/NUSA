const test = require("node:test");
const assert = require("node:assert/strict");
const { adaptPortfolioWeights } = require("../dist/apps/cloud/src/ampi.js");

test("AMPI adapts weights deterministically and remains recommendation-only", () => {
  const result = adaptPortfolioWeights({ baseWeights: { slow: 0.4, fast: 0.2 }, regimeConfidence: 0.8, liquidityScore: 0.5, uncertainty: 0.25, preservationMultiplier: 1 });
  assert.deepEqual(result.weights, { fast: 0.06, slow: 0.12 });
  assert.equal(result.recommendationOnly, true);
  assert.equal(result.productionMutationAllowed, false);
});

test("uncertainty reduces every allocation", () => {
  const result = adaptPortfolioWeights({ baseWeights: { strategy: 0.5 }, regimeConfidence: 0.4, liquidityScore: 1, uncertainty: 0.8, preservationMultiplier: 1 });
  assert.equal(result.weights.strategy, 0.04);
  assert.deepEqual(result.reasons, ["REGIME_UNCERTAIN", "UNCERTAINTY_HIGH"]);
});
