const test = require("node:test");
const assert = require("node:assert/strict");
const { buildRegimeTimeline, calculateRegimeClassifierId } = require("../dist/apps/desktop/src/strategy/marketRegime.js");

const candle = (index, close, volume = 100) => ({
  market: "KRW-BTC",
  interval: "1m",
  openTime: index * 60_000,
  closeTime: (index + 1) * 60_000,
  open: close,
  high: close,
  low: close,
  close,
  volume
});

const config = (overrides = {}) => ({
  trendLookback: 2,
  volatilityLookback: 2,
  liquidityLookback: 2,
  trendThreshold: 0.01,
  lowVolatilityThreshold: 0.005,
  highVolatilityThreshold: 0.05,
  lowLiquidityThreshold: 0.8,
  highLiquidityThreshold: 1.2,
  minimumSamples: 2,
  classifierVersion: "regime-v1",
  ...overrides
});

const candles = (prices, volumes = prices.map(() => 100)) => prices.map((price, index) => candle(index, price, volumes[index]));

test("1 first lookback points are UNKNOWN", () => {
  const timeline = buildRegimeTimeline(candles([100, 101, 103]), config());
  assert.equal(timeline.points[0].regime.trend, "UNKNOWN");
  assert.equal(timeline.points[1].regime.volatility, "UNKNOWN");
  assert.ok(timeline.warnings.includes("INSUFFICIENT_LOOKBACK"));
});

test("2 classifies up trend and 3 down trend", () => {
  const up = buildRegimeTimeline(candles([100, 102, 105]), config());
  const down = buildRegimeTimeline(candles([100, 98, 95]), config());
  assert.equal(up.points[2].regime.trend, "UP_TREND");
  assert.equal(down.points[2].regime.trend, "DOWN_TREND");
});

test("4 classifies range", () => {
  const timeline = buildRegimeTimeline(candles([100, 100.2, 100.4]), config({ trendThreshold: 0.02 }));
  assert.equal(timeline.points[2].regime.trend, "RANGE");
});

test("5 classifies low and high volatility", () => {
  const low = buildRegimeTimeline(candles([100, 100.1, 100.2]), config());
  const high = buildRegimeTimeline(candles([100, 130, 80]), config());
  assert.equal(low.points[2].regime.volatility, "LOW_VOLATILITY");
  assert.equal(high.points[2].regime.volatility, "HIGH_VOLATILITY");
});

test("6 classifies liquidity from past-only rolling volume", () => {
  const high = buildRegimeTimeline(candles([100, 101, 102], [100, 100, 200]), config());
  const low = buildRegimeTimeline(candles([100, 101, 102], [100, 100, 50]), config());
  assert.equal(high.points[2].regime.liquidity, "HIGH_LIQUIDITY");
  assert.equal(low.points[2].regime.liquidity, "LOW_LIQUIDITY");
});

test("7 zero historical volume produces UNKNOWN liquidity", () => {
  const timeline = buildRegimeTimeline(candles([100, 101, 102], [0, 0, 10]), config());
  assert.equal(timeline.points[2].regime.liquidity, "UNKNOWN");
  assert.ok(timeline.warnings.includes("MISSING_VOLUME"));
});

test("8 deterministic replay and 9 config identity", () => {
  const input = candles([100, 102, 105, 104]);
  assert.deepEqual(buildRegimeTimeline(input, config()), buildRegimeTimeline(input, config()));
  assert.equal(calculateRegimeClassifierId(config()), calculateRegimeClassifierId({ classifierVersion: "regime-v1", minimumSamples: 2, highLiquidityThreshold: 1.2, lowLiquidityThreshold: 0.8, highVolatilityThreshold: 0.05, lowVolatilityThreshold: 0.005, trendThreshold: 0.01, liquidityLookback: 2, volatilityLookback: 2, trendLookback: 2 }));
  assert.notEqual(calculateRegimeClassifierId(config()), calculateRegimeClassifierId(config({ trendThreshold: 0.02 })));
});

test("10 future candle changes cannot alter earlier regimes", () => {
  const original = buildRegimeTimeline(candles([100, 102, 105, 106, 107]), config());
  const changed = buildRegimeTimeline(candles([100, 102, 105, 10_000, 1]), config());
  assert.deepEqual(original.points.slice(0, 3), changed.points.slice(0, 3));
});

test("11 strategy points use completed closeTime and close", () => {
  const timeline = buildRegimeTimeline(candles([100, 102, 105]), config());
  assert.deepEqual(timeline.points[2].point, { timestamp: 180_000, close: 105 });
});

test("12 counts regimes and transitions", () => {
  const timeline = buildRegimeTimeline(candles([100, 102, 105, 100, 95]), config());
  assert.equal(Object.values(timeline.regimeCounts).reduce((sum, count) => sum + count, 0), 5);
  assert.ok(Object.values(timeline.transitionCounts).reduce((sum, count) => sum + count, 0) >= 1);
});

test("13 invalid thresholds and 14 reverse time fail closed", () => {
  assert.throws(() => buildRegimeTimeline(candles([100, 101, 102]), config({ lowVolatilityThreshold: 1, highVolatilityThreshold: 0.5 })), /inverted/);
  const input = candles([100, 101, 102]);
  input[2] = { ...input[2], closeTime: input[1].closeTime };
  assert.throws(() => buildRegimeTimeline(input, config()), /strictly ordered/);
});
