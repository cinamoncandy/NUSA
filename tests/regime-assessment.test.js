const test = require("node:test");
const assert = require("node:assert/strict");
const { runRegimeAnalysisRequest, assessRegime, assessStrategyDependency } = require("../scripts/lib/regime-analysis-runner.js");

function summary(overrides = {}) {
  return {
    trend: "UP_TREND", volatility: "NORMAL_VOLATILITY",
    candleCount: 100, segmentCount: 3, tradeCount: 10,
    winCount: 6, lossCount: 4, winRate: 0.6,
    grossProfit: 100, grossLoss: 40, netPnL: 50, fees: 10,
    profitFactor: 2.5, costToGrossProfitRatio: 0.1,
    benchmarkReturn: 0.01, insufficientSample: false,
    ...overrides
  };
}

test("an UNKNOWN dimension is always UNCLASSIFIED, even with excellent numbers", () => {
  const base = summary({ trend: "UNKNOWN", netPnL: 9_999_999 });
  assert.equal(assessRegime(base, summary({ netPnL: 9_999_999 })), "UNCLASSIFIED");
});

test("a regime below the declared minimum sample is INCONCLUSIVE, even when profitable", () => {
  const base = summary({ insufficientSample: true, netPnL: 500 });
  assert.equal(assessRegime(base, summary({ netPnL: 500 })), "INCONCLUSIVE");
});

test("a losing regime whose fees consume most of gross profit is HOSTILE", () => {
  const base = summary({ netPnL: -30, costToGrossProfitRatio: 0.8 });
  assert.equal(assessRegime(base, summary({ netPnL: -50 })), "HOSTILE");
});

test("a losing regime with a very low win rate is HOSTILE", () => {
  const base = summary({ netPnL: -30, winRate: 0.1, costToGrossProfitRatio: 0.1 });
  assert.equal(assessRegime(base, summary({ netPnL: -50 })), "HOSTILE");
});

test("a mildly losing regime that is not cost-dominated is WEAK, not HOSTILE", () => {
  const base = summary({ netPnL: -5, winRate: 0.45, costToGrossProfitRatio: 0.1 });
  assert.equal(assessRegime(base, summary({ netPnL: -20 })), "WEAK");
});

test("a regime profitable at BASE but collapsing under SEVERE cost is ACCEPTABLE, never STRONG", () => {
  const base = summary({ netPnL: 50 });
  const severe = summary({ netPnL: -10 });
  assert.equal(assessRegime(base, severe), "ACCEPTABLE");
});

test("a regime profitable at BASE and surviving SEVERE cost is STRONG", () => {
  assert.equal(assessRegime(summary({ netPnL: 50 }), summary({ netPnL: 12 })), "STRONG");
});

test("strategy dependency is RANGE_SENSITIVE when only RANGE loses", () => {
  const dependency = assessStrategyDependency({
    UP_TREND: summary({ netPnL: 100 }),
    DOWN_TREND: summary({ netPnL: 20 }),
    RANGE: summary({ netPnL: -40 })
  });
  assert.equal(dependency, "RANGE_SENSITIVE");
});

test("strategy dependency is BROADLY_STABLE when no conclusive regime loses", () => {
  const dependency = assessStrategyDependency({
    UP_TREND: summary({ netPnL: 100 }),
    DOWN_TREND: summary({ netPnL: 20 }),
    RANGE: summary({ netPnL: 5 })
  });
  assert.equal(dependency, "BROADLY_STABLE");
});

test("strategy dependency is BROADLY_WEAK when every conclusive regime loses", () => {
  const dependency = assessStrategyDependency({
    UP_TREND: summary({ netPnL: -100 }),
    DOWN_TREND: summary({ netPnL: -20 }),
    RANGE: summary({ netPnL: -40 })
  });
  assert.equal(dependency, "BROADLY_WEAK");
});

test("strategy dependency is INCONCLUSIVE when every regime is below its sample gate", () => {
  const dependency = assessStrategyDependency({
    UP_TREND: summary({ insufficientSample: true }),
    DOWN_TREND: summary({ insufficientSample: true }),
    RANGE: summary({ insufficientSample: true })
  });
  assert.equal(dependency, "INCONCLUSIVE");
});

test("raising the minimum-sample gate pushes thin regimes to INCONCLUSIVE rather than grading them", () => {
  const candles = Array.from({ length: 500 }, (_, i) => {
    const close = Math.round(100_000 + Math.sin(i / 6) * 800 + Math.sin(i / 40) * 4000);
    return {
      market: "KRW-BTC", interval: "1m", openTime: i * 60_000, closeTime: i * 60_000 + 60_000,
      open: close, high: close + 5, low: close - 5, close, volume: 1
    };
  });
  const request = {
    schemaVersion: 1, id: "REGIME-GATE-001", market: "KRW-BTC", candles,
    strategy: { shortWindow: 5, longWindow: 20 },
    classifier: {
      trendLookback: 60, volatilityLookback: 60, liquidityLookback: 60,
      trendThreshold: 0.01, lowVolatilityThreshold: 0.0005, highVolatilityThreshold: 0.002,
      lowLiquidityThreshold: 0.5, highLiquidityThreshold: 1.5,
      minimumSamples: 60, classifierVersion: "wo0029-v1"
    },
    thresholdSource: "FIXED_ABSOLUTE",
    minimumSample: { candles: 100_000, segments: 100, trades: 100 },
    transitionWindow: { preCandles: 10, postCandles: 10 },
    execution: { initialCash: 10_000_000, executionCosts: { spreadBps: 0 }, latencyCandles: 0, riskPolicy: {} },
    costConditions: [
      { name: "BASE", feeRate: 0.0005, slippageBps: 5 },
      { name: "MODERATE", feeRate: 0.001, slippageBps: 10 },
      { name: "SEVERE", feeRate: 0.002, slippageBps: 30 }
    ]
  };
  const result = runRegimeAnalysisRequest(request);
  assert.equal(result.status, "PASS", JSON.stringify(result.failures));
  for (const regime of result.regimes) {
    assert.ok(["INCONCLUSIVE", "UNCLASSIFIED"].includes(regime.assessment), `${regime.key} was graded ${regime.assessment}`);
  }
  assert.equal(result.aggregate.strongestRegime, null);
});
