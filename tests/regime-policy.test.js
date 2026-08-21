const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyPriceRegime, evaluateStrategyRegime } = require("../dist/apps/desktop/src/strategy/regimePolicy.js");

const prices = (start, step, count = 21) => Array.from({ length: count }, (_, index) => start + step * index);

test("classifies deterministic trend and volatility regimes", () => {
  assert.equal(classifyPriceRegime(prices(100, 1), 1), "STRONG_UPTREND");
  assert.equal(classifyPriceRegime(prices(100, -1), 1), "STRONG_DOWNTREND");
  assert.equal(classifyPriceRegime(prices(100, 0), 1), "LOW_VOLATILITY");
  const volatile = prices(100, 1).map((value, index) => value * (index % 2 ? 1.04 : 0.96));
  assert.equal(classifyPriceRegime(volatile, 1), "HIGH_VOLATILITY");
  assert.equal(classifyPriceRegime([100, 101], 1), undefined);
});

test("SMA mapping blocks only new exposure in forbidden regimes", () => {
  const preferred = evaluateStrategyRegime("sma-crossover", "STRONG_UPTREND");
  const forbidden = evaluateStrategyRegime("sma-crossover", "STRONG_DOWNTREND");
  assert.equal(preferred.preference, "PREFERRED");
  assert.equal(preferred.allowNewExposure, true);
  assert.equal(forbidden.preference, "FORBIDDEN");
  assert.equal(forbidden.allowNewExposure, false);
  assert.equal(evaluateStrategyRegime("sma-crossover", "SIDEWAYS").risk.positionSizeMultiplier, 0.5);
});
