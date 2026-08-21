const test = require("node:test");
const assert = require("node:assert/strict");
const { runRegimeAnalysisRequest, buildSegments } = require("../scripts/lib/regime-analysis-runner.js");
const { buildRegimeTimeline } = require("../dist/apps/desktop/src/strategy/marketRegime.js");

function candle(openTime, close) {
  return { market: "KRW-BTC", interval: "1m", openTime, closeTime: openTime + 60_000, open: close, high: close + 5, low: close - 5, close, volume: 1 };
}
function wavyCandles(count) {
  return Array.from({ length: count }, (_, i) => candle(i * 60_000, Math.round(100_000 + Math.sin(i / 6) * 800 + Math.sin(i / 40) * 4000)));
}

const classifier = {
  trendLookback: 60, volatilityLookback: 60, liquidityLookback: 60,
  trendThreshold: 0.01, lowVolatilityThreshold: 0.0005, highVolatilityThreshold: 0.002,
  lowLiquidityThreshold: 0.5, highLiquidityThreshold: 1.5,
  minimumSamples: 60, classifierVersion: "wo0029-v1"
};

function baseRequest(candles = wavyCandles(500)) {
  return {
    schemaVersion: 1, id: "REGIME-SEG-001", market: "KRW-BTC", candles,
    strategy: { shortWindow: 5, longWindow: 20 },
    classifier,
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

test("segments tile the candle array exactly once with no gap and no overlap", () => {
  const candles = wavyCandles(500);
  const timeline = buildRegimeTimeline(candles, classifier);
  const segments = buildSegments(candles, timeline);
  let expected = 0;
  for (const segment of segments) {
    assert.equal(segment.startIndex, expected);
    expected = segment.endIndex + 1;
  }
  assert.equal(expected, candles.length);
});

test("every segment is internally homogeneous in its regime key", () => {
  const candles = wavyCandles(500);
  const timeline = buildRegimeTimeline(candles, classifier);
  const segments = buildSegments(candles, timeline);
  for (const segment of segments) {
    for (let index = segment.startIndex; index <= segment.endIndex; index += 1) {
      const regime = timeline.points[index].regime;
      assert.equal(`${regime.trend}|${regime.volatility}`, segment.key);
    }
  }
});

test("short segments are preserved, never merged away or deleted", () => {
  const candles = wavyCandles(500);
  const timeline = buildRegimeTimeline(candles, classifier);
  const segments = buildSegments(candles, timeline);
  const totalCandles = segments.reduce((sum, segment) => sum + segment.candleCount, 0);
  assert.equal(totalCandles, candles.length);
});

test("segment candleCount always matches its own index range", () => {
  const candles = wavyCandles(400);
  const timeline = buildRegimeTimeline(candles, classifier);
  for (const segment of buildSegments(candles, timeline)) {
    assert.equal(segment.candleCount, segment.endIndex - segment.startIndex + 1);
  }
});

test("segment start/end times come from the underlying candles", () => {
  const candles = wavyCandles(300);
  const timeline = buildRegimeTimeline(candles, classifier);
  for (const segment of buildSegments(candles, timeline)) {
    assert.equal(segment.startTime, candles[segment.startIndex].openTime);
    assert.equal(segment.endTime, candles[segment.endIndex].closeTime);
  }
});

test("coverage counts labeled and unknown candles consistently with the segment array", () => {
  const result = runRegimeAnalysisRequest(baseRequest());
  assert.equal(result.status, "PASS", JSON.stringify(result.failures));
  assert.equal(result.coverage.labeledCandles + result.coverage.unknownCandles, result.coverage.totalCandles);
  assert.equal(result.coverage.segmentCount, result.segments.length);
});

test("transitions sit on segment boundaries and number exactly segmentCount minus one", () => {
  const result = runRegimeAnalysisRequest(baseRequest());
  assert.equal(result.status, "PASS", JSON.stringify(result.failures));
  assert.equal(result.transitions.length, result.segments.length - 1);
  const starts = new Set(result.segments.map((segment) => segment.startIndex));
  for (const transition of result.transitions) assert.ok(starts.has(transition.boundaryIndex));
});
