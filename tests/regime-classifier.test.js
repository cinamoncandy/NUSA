const test = require("node:test");
const assert = require("node:assert/strict");
const { reclassify } = require("../scripts/lib/regime-analysis-verifier.js");
const { buildRegimeTimeline } = require("../dist/apps/desktop/src/strategy/marketRegime.js");

function candle(openTime, close) {
  return { market: "KRW-BTC", interval: "1m", openTime, closeTime: openTime + 60_000, open: close, high: close + 5, low: close - 5, close, volume: 1 };
}

const classifier = {
  trendLookback: 10, volatilityLookback: 10, liquidityLookback: 10,
  trendThreshold: 0.01, lowVolatilityThreshold: 0.0005, highVolatilityThreshold: 0.002,
  lowLiquidityThreshold: 0.5, highLiquidityThreshold: 1.5,
  minimumSamples: 10, classifierVersion: "test-v1"
};

test("the independent verifier's reclassification agrees with the production classifier on a rising series", () => {
  const candles = Array.from({ length: 60 }, (_, i) => candle(i * 60_000, Math.round(100_000 * (1 + i * 0.005))));
  const timeline = buildRegimeTimeline(candles, classifier);
  const independent = reclassify(candles, classifier);
  const production = timeline.points.map((entry) => `${entry.regime.trend}|${entry.regime.volatility}`);
  assert.deepEqual(independent, production);
});

test("the independent verifier's reclassification agrees with the production classifier on a falling series", () => {
  const candles = Array.from({ length: 60 }, (_, i) => candle(i * 60_000, Math.round(100_000 * (1 - i * 0.005))));
  const timeline = buildRegimeTimeline(candles, classifier);
  const independent = reclassify(candles, classifier);
  const production = timeline.points.map((entry) => `${entry.regime.trend}|${entry.regime.volatility}`);
  assert.deepEqual(independent, production);
});

test("a sustained rise is labeled UP_TREND once warm-up has elapsed", () => {
  const candles = Array.from({ length: 40 }, (_, i) => candle(i * 60_000, Math.round(100_000 * (1 + i * 0.01))));
  const labels = reclassify(candles, classifier);
  assert.ok(labels.slice(15).every((label) => label.startsWith("UP_TREND")));
});

test("a sustained fall is labeled DOWN_TREND once warm-up has elapsed", () => {
  const candles = Array.from({ length: 40 }, (_, i) => candle(i * 60_000, Math.round(100_000 * (1 - i * 0.01))));
  const labels = reclassify(candles, classifier);
  assert.ok(labels.slice(15).every((label) => label.startsWith("DOWN_TREND")));
});

test("a flat series is labeled RANGE once warm-up has elapsed", () => {
  const candles = Array.from({ length: 40 }, (_, i) => candle(i * 60_000, 100_000));
  const labels = reclassify(candles, classifier);
  assert.ok(labels.slice(15).every((label) => label.startsWith("RANGE")));
});

test("warm-up candles are UNKNOWN and are never silently folded into a real regime", () => {
  const candles = Array.from({ length: 40 }, (_, i) => candle(i * 60_000, Math.round(100_000 * (1 + i * 0.01))));
  const labels = reclassify(candles, classifier);
  for (let index = 0; index < classifier.minimumSamples; index += 1) {
    assert.equal(labels[index], "UNKNOWN|UNKNOWN");
  }
});

test("a label never depends on a future candle: truncating the series leaves earlier labels unchanged", () => {
  const full = Array.from({ length: 60 }, (_, i) => candle(i * 60_000, Math.round(100_000 + Math.sin(i / 4) * 3000)));
  const truncated = full.slice(0, 40);
  const fullLabels = reclassify(full, classifier);
  const truncatedLabels = reclassify(truncated, classifier);
  assert.deepEqual(truncatedLabels, fullLabels.slice(0, 40));
});

test("appending a wildly different future candle does not change any earlier label", () => {
  const base = Array.from({ length: 40 }, (_, i) => candle(i * 60_000, Math.round(100_000 + Math.sin(i / 4) * 3000)));
  const withShock = [...base, candle(40 * 60_000, 999_999)];
  assert.deepEqual(reclassify(withShock, classifier).slice(0, 40), reclassify(base, classifier));
});

test("a high-volatility series is labeled HIGH_VOLATILITY", () => {
  const candles = Array.from({ length: 40 }, (_, i) => candle(i * 60_000, Math.round(100_000 * (1 + (i % 2 === 0 ? 0.03 : -0.03)))));
  const labels = reclassify(candles, classifier);
  assert.ok(labels.slice(15).every((label) => label.endsWith("HIGH_VOLATILITY")));
});

test("a perfectly flat series has zero realized volatility and is labeled LOW_VOLATILITY", () => {
  const candles = Array.from({ length: 40 }, (_, i) => candle(i * 60_000, 100_000));
  const labels = reclassify(candles, classifier);
  assert.ok(labels.slice(15).every((label) => label.endsWith("LOW_VOLATILITY")));
});
