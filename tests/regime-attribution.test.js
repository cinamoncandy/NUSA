const test = require("node:test");
const assert = require("node:assert/strict");
const { runRegimeAnalysisRequest } = require("../scripts/lib/regime-analysis-runner.js");

function candle(openTime, close) {
  return { market: "KRW-BTC", interval: "1m", openTime, closeTime: openTime + 60_000, open: close, high: close + 5, low: close - 5, close, volume: 1 };
}
function wavyCandles(count) {
  return Array.from({ length: count }, (_, i) => candle(i * 60_000, Math.round(100_000 + Math.sin(i / 6) * 800 + Math.sin(i / 40) * 4000)));
}

function baseRequest(candles = wavyCandles(500)) {
  return {
    schemaVersion: 1, id: "REGIME-ATTR-001", market: "KRW-BTC", candles,
    strategy: { shortWindow: 5, longWindow: 20 },
    classifier: {
      trendLookback: 60, volatilityLookback: 60, liquidityLookback: 60,
      trendThreshold: 0.01, lowVolatilityThreshold: 0.0005, highVolatilityThreshold: 0.002,
      lowLiquidityThreshold: 0.5, highLiquidityThreshold: 1.5,
      minimumSamples: 60, classifierVersion: "wo0029-v1"
    },
    thresholdSource: "FIXED_ABSOLUTE",
    minimumSample: { candles: 20, segments: 1, trades: 1 },
    transitionWindow: { preCandles: 10, postCandles: 10 },
    execution: { initialCash: 10_000_000, executionCosts: { spreadBps: 0 }, latencyCandles: 0, riskPolicy: {} },
    costConditions: [
      { name: "BASE", feeRate: 0.0005, slippageBps: 5 },
      { name: "MODERATE", feeRate: 0.001, slippageBps: 10 },
      { name: "SEVERE", feeRate: 0.002, slippageBps: 30 }
    ]
  };
}

test("per-regime trade counts partition the total exactly once (no trade double-counted, none dropped)", () => {
  const result = runRegimeAnalysisRequest(baseRequest());
  assert.equal(result.status, "PASS", JSON.stringify(result.failures));
  const summed = result.regimes.reduce((sum, regime) => sum + regime.byCondition.BASE.tradeCount, 0);
  assert.equal(summed, result.aggregate.totalTrades);
});

test("per-regime net PnL reconciles to the aggregate total", () => {
  const result = runRegimeAnalysisRequest(baseRequest());
  assert.equal(result.status, "PASS", JSON.stringify(result.failures));
  const summed = result.regimes.reduce((sum, regime) => sum + regime.byCondition.BASE.netPnL, 0);
  assert.ok(Math.abs(summed - result.aggregate.totalNetPnL) < 1e-6);
});

test("per-regime fees reconcile to the aggregate total", () => {
  const result = runRegimeAnalysisRequest(baseRequest());
  assert.equal(result.status, "PASS", JSON.stringify(result.failures));
  const summed = result.regimes.reduce((sum, regime) => sum + regime.byCondition.BASE.fees, 0);
  assert.ok(Math.abs(summed - result.aggregate.totalFees) < 1e-6);
});

test("win and loss counts never exceed the regime's own trade count", () => {
  const result = runRegimeAnalysisRequest(baseRequest());
  assert.equal(result.status, "PASS", JSON.stringify(result.failures));
  for (const regime of result.regimes) {
    const base = regime.byCondition.BASE;
    assert.ok(base.winCount + base.lossCount <= base.tradeCount);
  }
});

test("attribution is stable across cost conditions in candle coverage, even as trades change", () => {
  const result = runRegimeAnalysisRequest(baseRequest());
  assert.equal(result.status, "PASS", JSON.stringify(result.failures));
  for (const regime of result.regimes) {
    // Regime labels do not depend on execution cost, so candle/segment counts must be
    // identical under all three conditions; only trades and PnL may differ.
    assert.equal(regime.byCondition.BASE.candleCount, regime.byCondition.SEVERE.candleCount);
    assert.equal(regime.byCondition.BASE.segmentCount, regime.byCondition.SEVERE.segmentCount);
  }
});

test("a warm-up UNKNOWN bucket is reported but never given a performance grade", () => {
  const result = runRegimeAnalysisRequest(baseRequest());
  assert.equal(result.status, "PASS", JSON.stringify(result.failures));
  for (const regime of result.regimes) {
    if (regime.trend === "UNKNOWN" || regime.volatility === "UNKNOWN") {
      assert.equal(regime.assessment, "UNCLASSIFIED");
    }
  }
});

test("strongest and weakest regimes are never an UNCLASSIFIED or INCONCLUSIVE bucket", () => {
  const result = runRegimeAnalysisRequest(baseRequest());
  assert.equal(result.status, "PASS", JSON.stringify(result.failures));
  for (const key of [result.aggregate.strongestRegime, result.aggregate.weakestRegime]) {
    if (key == null) continue;
    const regime = result.regimes.find((entry) => entry.key === key);
    assert.ok(!["UNCLASSIFIED", "INCONCLUSIVE"].includes(regime.assessment));
  }
});
